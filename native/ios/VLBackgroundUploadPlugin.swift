import Foundation
import UIKit
import WebKit
import UniformTypeIdentifiers
import Capacitor

// Add this Swift file to the iOS App target and register it from a CAPBridgeViewController.
// The browser version intentionally does not pretend to support native background transfers.
@objc(VLBackgroundUploadPlugin)
public class VLBackgroundUploadPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "VLBackgroundUploadPlugin"
    public let jsName = "VLBackgroundUpload"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickAndUpload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getJobs", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acknowledge", returnType: CAPPluginReturnPromise)
    ]
    private var pickerCall: CAPPluginCall?

    override public func load() {
        VLBackgroundUploadCoordinator.shared.restoreBackgroundSession()
    }

    @objc func pickAndUpload(_ call: CAPPluginCall) {
        guard let origin = call.getString("origin"),
              let url = URL(string: origin), url.scheme == "https", url.path.isEmpty,
              let folder = call.getString("folderId"),
              folder.range(of: "^[A-Za-z0-9_-]{10,180}$", options: .regularExpression) != nil,
              let owner = call.getString("owner"), owner.contains("@") else {
            call.reject("Cấu hình máy chủ hoặc tài khoản không hợp lệ")
            return
        }
        guard pickerCall == nil else { call.reject("Đang chọn file"); return }
        pickerCall = call
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.image, UTType.movie], asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = true
        bridge?.viewController?.present(picker, animated: true)
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pickerCall?.resolve(["jobs": []])
        pickerCall = nil
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pickerCall else { return }
        pickerCall = nil
        let origin = call.getString("origin") ?? ""
        let owner = (call.getString("owner") ?? "").lowercased()
        let folder = call.getString("folderId") ?? ""
        guard let cookieStore = bridge?.getWebView()?.configuration.websiteDataStore.httpCookieStore else {
            call.reject("Không đọc được phiên xác thực đăng nhập")
            return
        }
        // Copies are staged before URLSession background tasks are scheduled.
        // iOS offers a limited grace period when the user immediately leaves the app.
        let bg = UIApplication.shared.beginBackgroundTask(withName: "VinhLocStageUploads")
        cookieStore.getAllCookies { cookies in
            let host = URL(string: origin)?.host ?? ""
            let matching = cookies.filter { host == $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")) ||
                host.hasSuffix("." + $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))) }
            let cookieHeader = matching.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
            VLBackgroundUploadCoordinator.shared.stageAndQueue(urls: urls, origin: origin, owner: owner,
                                                               folder: folder, cookies: cookieHeader) { jobs, error in
                DispatchQueue.main.async {
                    if bg != .invalid { UIApplication.shared.endBackgroundTask(bg) }
                    if let error = error { call.reject(error.localizedDescription) }
                    else { call.resolve(["jobs": jobs]) }
                }
            }
        }
    }

    @objc func getJobs(_ call: CAPPluginCall) {
        let jobs = VLBackgroundUploadCoordinator.shared.visibleJobs()
        if call.getBool("resume") == true {
            bridge?.getWebView()?.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
                VLBackgroundUploadCoordinator.shared.resumeWithCookies(cookies)
            }
        }
        call.resolve(["jobs": jobs])
    }

    @objc func acknowledge(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let driveId = call.getString("fileId") else {
            call.reject("Thiếu ID file"); return
        }
        VLBackgroundUploadCoordinator.shared.acknowledge(id: id, driveId: driveId)
        call.resolve()
    }
}

private struct VLUploadItem: Codable {
    var id: String
    var uploadKey: String
    var name: String
    var mimeType: String
    var size: Int64
    var folderId: String
    var owner: String
    var origin: String
    var filePath: String
    var sessionURL: String?
    var status: String
    var bytesSent: Int64
    var fileId: String?
    var error: String?
}

// A single stable background session survives app suspension and system relaunch.
// Resumable Drive PUTs use uploadTask(fromFile:) - never a data/stream upload.
public final class VLBackgroundUploadCoordinator: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
    public static let shared = VLBackgroundUploadCoordinator()
    private let lock = NSRecursiveLock()
    private var records: [String: VLUploadItem] = [:]
    private var responses: [Int: Data] = [:]
    private var finishEvents: (() -> Void)?
    private lazy var session: URLSession = {
        let cfg = URLSessionConfiguration.background(withIdentifier: "com.vinhloc.drive.background-upload.v1")
        cfg.isDiscretionary = false
        cfg.sessionSendsLaunchEvents = true
        cfg.waitsForConnectivity = true
        return URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
    }()
    private lazy var directory: URL = {
        var root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("VLBackgroundUploads", isDirectory: true)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        var settings = URLResourceValues()
        settings.isExcludedFromBackup = true
        try? root.setResourceValues(settings)
        return root
    }()

    private override init() {
        super.init()
        if let data = try? Data(contentsOf: directory.appendingPathComponent("queue.json")),
           let saved = try? JSONDecoder().decode([String: VLUploadItem].self, from: data) {
            records = saved
        }
    }
    public func restoreBackgroundSession() { _ = session }

    public func handleBackgroundEvents(identifier: String, completionHandler: @escaping () -> Void) {
        guard identifier == "com.vinhloc.drive.background-upload.v1" else { completionHandler(); return }
        lock.lock(); finishEvents = completionHandler; lock.unlock()
        restoreBackgroundSession()
    }
    public func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        lock.lock(); let completion = finishEvents; finishEvents = nil; lock.unlock()
        if let completion = completion { DispatchQueue.main.async(execute: completion) }
    }

    private func persist() {
        // Must be called under lock.
        if let data = try? JSONEncoder().encode(records) {
            try? data.write(to: directory.appendingPathComponent("queue.json"), options: .atomic)
        }
    }
    public func visibleJobs() -> [[String: Any]] {
        lock.lock(); defer { lock.unlock() }
        return records.values.map { item in [
            "id": item.id, "name": item.name, "mimeType": item.mimeType,
            "size": item.size, "folderId": item.folderId, "uploadKey": item.uploadKey,
            "owner": item.owner, "status": item.status, "bytesSent": item.bytesSent,
            "fileId": item.fileId ?? "", "error": item.error ?? ""
        ] }
    }
    public func stageAndQueue(urls: [URL], origin: String, owner: String, folder: String,
                              cookies: String, completion: @escaping ([[String: Any]], Error?) -> Void) {
        DispatchQueue.global(qos: .utility).async {
            do {
                guard !cookies.isEmpty else { throw NSError(domain: "VLUpload", code: 401,
                    userInfo: [NSLocalizedDescriptionKey: "Cần xác thực phiên Google trên website"]) }
                var staged: [VLUploadItem] = []
                for source in urls {
                    let accessed = source.startAccessingSecurityScopedResource()
                    defer { if accessed { source.stopAccessingSecurityScopedResource() } }
                    let attr = try FileManager.default.attributesOfItem(atPath: source.path)
                    let size = (attr[.size] as? NSNumber)?.int64Value ?? 0
                    guard size > 0 && size <= 5 * 1024 * 1024 * 1024 else { continue }
                    let mime = UTType(filenameExtension: source.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
                    guard mime.hasPrefix("image/") || mime.hasPrefix("video/") else { continue }
                    let id = UUID().uuidString
                    let copy = self.directory.appendingPathComponent(id + ".data")
                    try FileManager.default.copyItem(at: source, to: copy)
                    staged.append(VLUploadItem(id: id, uploadKey: UUID().uuidString.replacingOccurrences(of: "-", with: ""),
                        name: source.lastPathComponent, mimeType: mime, size: size, folderId: folder, owner: owner,
                        origin: origin, filePath: copy.path, sessionURL: nil, status: "queued",
                        bytesSent: 0, fileId: nil, error: nil))
                }
                self.lock.lock()
                for job in staged { self.records[job.id] = job }
                self.persist()
                self.lock.unlock()
                for job in staged { self.prepare(job: job, cookies: cookies) }
                completion(self.visibleJobs().filter { j in staged.contains { $0.id == j["id"] as? String } }, nil)
            } catch { completion([], error) }
        }
    }
    private func cookieHeader(_ cookies: [HTTPCookie], for origin: String) -> String {
        let host = URL(string: origin)?.host ?? ""
        return cookies.filter { host == $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")) ||
            host.hasSuffix("." + $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))) }
            .map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
    }
    public func resumeWithCookies(_ cookies: [HTTPCookie]) {
        lock.lock(); let pending = records.values.filter { ["queued", "auth_required", "paused"].contains($0.status) }; lock.unlock()
        for job in pending {
            let header = cookieHeader(cookies, for: job.origin)
            guard !header.isEmpty else { continue }
            if job.sessionURL != nil { scheduleProbe(job: job) }
            else { prepare(job: job, cookies: header) }
        }
    }

    private func set(_ id: String, _ update: (inout VLUploadItem) -> Void) {
        lock.lock(); defer { lock.unlock() }
        guard var job = records[id] else { return }
        update(&job); records[id] = job; persist()
    }
    private func prepare(job: VLUploadItem, cookies: String) {
        guard let url = URL(string: job.origin + "/api/owned-files") else { return }
        let payload: [String: Any] = ["action": "startUpload", "folderId": job.folderId,
            "name": job.name, "mimeType": job.mimeType, "size": job.size,
            "uploadKey": job.uploadKey, "expectedOwner": job.owner]
        let bodyFile = directory.appendingPathComponent(job.id + "-prepare.json")
        do {
            try JSONSerialization.data(withJSONObject: payload).write(to: bodyFile, options: .atomic)
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
            request.setValue(cookies, forHTTPHeaderField: "Cookie")
            let task = session.uploadTask(with: request, fromFile: bodyFile)
            task.taskDescription = job.id + ":prepare"
            set(job.id) { $0.status = "preparing"; $0.error = nil }
            task.resume()
        } catch { set(job.id) { $0.status = "paused"; $0.error = error.localizedDescription } }
    }
    // Check the Drive-acknowledged byte offset before resuming after interruption.
    private func scheduleProbe(job: VLUploadItem) {
        guard let raw = job.sessionURL, raw.hasPrefix("https://www.googleapis.com/"),
              let url = URL(string: raw) else { return }
        let empty = directory.appendingPathComponent(job.id + "-probe.empty")
        FileManager.default.createFile(atPath: empty.path, contents: Data())
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("bytes */\\(job.size)", forHTTPHeaderField: "Content-Range")
        let task = session.uploadTask(with: request, fromFile: empty)
        task.taskDescription = job.id + ":probe"
        set(job.id) { $0.status = "probing"; $0.error = nil }
        task.resume()
    }
    private func scheduleDrive(job: VLUploadItem, offset: Int64) {
        guard let sessionURL = job.sessionURL, sessionURL.hasPrefix("https://www.googleapis.com/"),
              let url = URL(string: sessionURL) else { return }
        do {
            var bodyURL = URL(fileURLWithPath: job.filePath)
            if offset > 0 {
                // A 308 response may require sending only the remaining bytes.
                let suffix = directory.appendingPathComponent(job.id + "-remainder.data")
                if FileManager.default.fileExists(atPath: suffix.path) { try FileManager.default.removeItem(at: suffix) }
                FileManager.default.createFile(atPath: suffix.path, contents: nil)
                let reader = try FileHandle(forReadingFrom: bodyURL)
                let writer = try FileHandle(forWritingTo: suffix)
                defer { try? reader.close(); try? writer.close() }
                try reader.seek(toOffset: UInt64(offset))
                while true {
                    let part = try reader.read(upToCount: 256 * 1024) ?? Data()
                    if part.isEmpty { break }
                    try writer.write(contentsOf: part)
                }
                bodyURL = suffix
            }
            var request = URLRequest(url: url)
            request.httpMethod = "PUT"
            request.setValue(job.mimeType, forHTTPHeaderField: "Content-Type")
            request.setValue("bytes \(offset)-\(job.size - 1)/\(job.size)", forHTTPHeaderField: "Content-Range")
            let task = session.uploadTask(with: request, fromFile: bodyURL)
            task.taskDescription = job.id + ":drive:" + String(offset)
            set(job.id) { $0.status = "uploading"; $0.bytesSent = offset; $0.error = nil }
            task.resume()
        } catch { set(job.id) { $0.status = "paused"; $0.error = error.localizedDescription } }
    }

    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock(); responses[dataTask.taskIdentifier, default: Data()].append(data); lock.unlock()
    }
    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let description = task.taskDescription else { return }
        let parts = description.split(separator: ":")
        guard parts.count >= 2 else { return }
        let id = String(parts[0]), operation = String(parts[1])
        lock.lock(); let job = records[id]; let body = responses.removeValue(forKey: task.taskIdentifier) ?? Data(); lock.unlock()
        guard let job = job else { return }
        if let error = error {
            set(id) { $0.status = "paused"; $0.error = error.localizedDescription }; return
        }
        guard let response = task.response as? HTTPURLResponse else {
            set(id) { $0.status = "paused"; $0.error = "Không nhận được phản hồi Drive" }; return
        }
        if operation == "prepare" {
            guard (200..<300).contains(response.statusCode),
                  let result = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any],
                  result["success"] as? Bool == true,
                  (result["uploaderEmail"] as? String)?.lowercased() == job.owner,
                  let uploadURL = result["uploadUrl"] as? String,
                  uploadURL.hasPrefix("https://www.googleapis.com/") else {
                set(id) { $0.status = response.statusCode == 401 || response.statusCode == 403 ? "auth_required" : "paused";
                    $0.error = "Không tạo được phiên upload (HTTP \(response.statusCode))" }
                return
            }
            set(id) { $0.sessionURL = uploadURL }
            lock.lock(); let current = records[id]; lock.unlock()
            if let current = current { scheduleDrive(job: current, offset: 0) }
        } else if operation == "probe" {
            if response.statusCode == 308 {
                let range = response.value(forHTTPHeaderField: "Range") ?? ""
                let last = range.split(separator: "-").last.flatMap { Int64($0) } ?? -1
                scheduleDrive(job: job, offset: last + 1)
            } else if response.statusCode == 200 || response.statusCode == 201 {
                set(id) { $0.status = "uploaded"; $0.bytesSent = $0.size }
            } else {
                set(id) { $0.status = "paused"; $0.error = "Drive session HTTP \\(response.statusCode)" }
            }
        } else if operation == "drive" {
            if response.statusCode == 200 || response.statusCode == 201 {
                set(id) { $0.status = "uploaded"; $0.bytesSent = $0.size; $0.error = nil }
            } else if response.statusCode == 308 {
                let range = (response.value(forHTTPHeaderField: "Range") ?? "")
                let end = range.split(separator: "-").last.flatMap { Int64($0) } ?? -1
                let offset = end + 1
                if offset < job.size { scheduleDrive(job: job, offset: offset) }
                else { set(id) { $0.status = "uploaded"; $0.bytesSent = $0.size } }
            } else {
                set(id) { $0.status = response.statusCode == 401 || response.statusCode == 403 ? "auth_required" : "paused"
                    $0.error = "Google Drive HTTP \(response.statusCode)" }
            }
        }
    }
    public func acknowledge(id: String, driveId: String) {
        lock.lock(); let item = records[id]; lock.unlock()
        guard let job = item, job.status == "uploaded", !driveId.isEmpty else { return }
        set(id) { $0.status = "complete"; $0.fileId = driveId; $0.sessionURL = nil }
        try? FileManager.default.removeItem(atPath: job.filePath)
        try? FileManager.default.removeItem(at: directory.appendingPathComponent(job.id + "-remainder.data"))
        try? FileManager.default.removeItem(at: directory.appendingPathComponent(job.id + "-prepare.json"))
    }
}
