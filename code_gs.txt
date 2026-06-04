const ROOT_FOLDER_ID = "1xWDed1IBzGdCA4r5vbds1x6AF31hSIUT"; 
const SHEET_ID = "1rzm6zSX24UB03QOKRhR3O4BvGiQvnaOz6mhA6YL3GqA";
// THÊM DÒNG NÀY (Thay bằng ID thư mục mới của bạn):
const CACHE_FOLDER_ID = "1mneX5p8b4rIKNObOTxdn7yIDTlEscEZx"; 

function doPost(e) {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    const folderId = payload.folderId || ROOT_FOLDER_ID;
    
    
    let currentFolder;
    if (folderId && action !== 'getMeta' && action !== 'updateSingleMeta' && action !== 'globalSearch' && action !== 'getFileBase64' && action !== 'makePublic') {
      try { currentFolder = DriveApp.getFolderById(folderId); } catch(err){}
    }
    
    let result = { success: false, message: "Hành động không hợp lệ" };

    switch (action) {
      
case 'verifyUser':
      try {
        const userEmail = payload.email; 
        if (!userEmail) return ContentService.createTextOutput(JSON.stringify({ success: false, message: "Không nhận được Email từ Google Sign-in" })).setMimeType(ContentService.MimeType.JSON);

        const emailCheck = userEmail.trim().toLowerCase();

        try {
            // Lấy ID của Bộ nhớ dùng chung (Drive API v3)
            const folderInfo = Drive.Files.get(ROOT_FOLDER_ID, { supportsAllDrives: true });
            const driveId = folderInfo.driveId; 
            
            if (driveId) {
                // SỬA LỖI Ở ĐÂY: Drive API v3 dùng .permissions thay vì .items, 
                // và phải yêu cầu tham số fields để nó trả về emailAddress
                const permissionResponse = Drive.Permissions.list(driveId, { 
                    supportsAllDrives: true,
                    fields: "permissions(emailAddress, role)" 
                });
                
                const permissionsList = permissionResponse.permissions;
                let foundEmails = []; 
                
                if (permissionsList && permissionsList.length > 0) {
                    for (let i = 0; i < permissionsList.length; i++) {
                        if (permissionsList[i].emailAddress) {
                            foundEmails.push(permissionsList[i].emailAddress.toLowerCase());
                        }
                    }
                }
                
                // ĐỐI CHIẾU
                if (foundEmails.includes(emailCheck)) {
                    return ContentService.createTextOutput(JSON.stringify({ success: true, message: "Pass" })).setMimeType(ContentService.MimeType.JSON);
                } else {
                    return ContentService.createTextOutput(JSON.stringify({ 
                        success: false, 
                        message: `Tài khoản không được ủy quyền` 
                    })).setMimeType(ContentService.MimeType.JSON);
                }
            } else {
                return ContentService.createTextOutput(JSON.stringify({ success: false, message: "Không lấy được ID Bộ nhớ dùng chung" })).setMimeType(ContentService.MimeType.JSON);
            }
        } catch (e) {
            return ContentService.createTextOutput(JSON.stringify({ success: false, message: "Lỗi quét API Drive v3: " + e.message })).setMimeType(ContentService.MimeType.JSON);
        }

      } catch(err) {
        return ContentService.createTextOutput(JSON.stringify({ success: false, message: "Lỗi Server: " + err.message })).setMimeType(ContentService.MimeType.JSON);
      }      // --- PATCH: XỬ LÝ SAO CHÉP, DI CHUYỂN, DÁN, HOÀN TÁC ---
      // --- PATCH: XỬ LÝ SAO CHÉP, DI CHUYỂN, DÁN, HOÀN TÁC (ĐÃ FIX LỖI) ---
      case 'clipboardOps':
        try {
            const mode = payload.mode; // 'copy', 'move', 'undo'
            const items = payload.items; // [{id, type, origParent}]
            const targetFldId = payload.targetFolderId;
            const targetReplaceId = payload.targetReplaceId;
            let newIds = [];

            // 1. NẾU LÀ LỆNH HOÀN TÁC (UNDO)
            if (mode === 'undo') {
                const undoType = payload.undoType;
                if (undoType === 'copy') {
                    // Xóa các bản sao vừa tạo ra
                    items.forEach(i => {
                        try { DriveApp.getFileById(i.id).setTrashed(true); } catch(e){}
                        try { DriveApp.getFolderById(i.id).setTrashed(true); } catch(e){}
                    });
                } else if (undoType === 'move') {
                    // Trả lại vị trí cũ
                    items.forEach(i => {
                        try {
                            let node = i.type === 'file' ? DriveApp.getFileById(i.id) : DriveApp.getFolderById(i.id);
                            let targetP = DriveApp.getFolderById(i.origParent);
                            // SỬA LỖI: Dùng hàm moveTo() chuẩn của Google
                            node.moveTo(targetP);
                        } catch(e){}
                    });
                }
                // FIX LỖI MẠNG: Đóng gói JSON đúng chuẩn GAS
                return ContentService.createTextOutput(JSON.stringify({ success: true, message: "Hoàn tác thành công" })).setMimeType(ContentService.MimeType.JSON);
            }

            // 2. TÌM THƯ MỤC ĐÍCH
            let targetFolder;
            if (targetReplaceId) {
                try { 
                    // Dán đè lên 1 file -> Lấy thư mục cha của file đó làm đích
                    let repFile = DriveApp.getFileById(targetReplaceId);
                    if (repFile.getParents().hasNext()) targetFolder = repFile.getParents().next(); 
                } catch(e) {}
            }
            if (!targetFolder) targetFolder = DriveApp.getFolderById(targetFldId);
            
            // Hàm đệ quy copy thư mục
            function copyFolderRecursive(srcFld, destFld, prefix) {
                let newFld = destFld.createFolder(prefix + srcFld.getName());
                let files = srcFld.getFiles();
                while(files.hasNext()) files.next().makeCopy(newFld);
                let subFlds = srcFld.getFolders();
                while(subFlds.hasNext()) copyFolderRecursive(subFlds.next(), newFld, ""); 
                return newFld;
            }

            // 3. XỬ LÝ LỆNH SAO CHÉP / DI CHUYỂN
            for (let i of items) {
                let node = i.type === 'file' ? DriveApp.getFileById(i.id) : DriveApp.getFolderById(i.id);
                let origParent = node.getParents().hasNext() ? node.getParents().next().getId() : ""; // Tránh lỗi khi không có ID gốc

                if (mode === 'copy') {
                    let prefix = "Bản sao của_";
                    if (i.type === 'file') {
                        let newF = node.makeCopy(prefix + node.getName(), targetFolder);
                        newIds.push({id: newF.getId(), type: 'file', origParent: origParent});
                    } else {
                        let newFld = copyFolderRecursive(node, targetFolder, prefix);
                        newIds.push({id: newFld.getId(), type: 'folder', origParent: origParent});
                    }
                } else if (mode === 'move') {
                    // SỬA LỖI: Dùng .moveTo thay vì removeFile/addFile (bị chặn)
                    node.moveTo(targetFolder);
                    newIds.push({id: node.getId(), type: i.type, origParent: origParent});
                }
            }

            // 4. DỌN DẸP FILE CŨ NẾU LÀ "DÁN ĐÈ"
            if (targetReplaceId) {
                try { DriveApp.getFileById(targetReplaceId).setTrashed(true); } catch(e){}
            }

            // FIX LỖI MẠNG: Đóng gói dữ liệu trả về thành JSON String hợp lệ
            return ContentService.createTextOutput(JSON.stringify({ success: true, processedItems: newIds })).setMimeType(ContentService.MimeType.JSON);
            
        } catch (err) {
            // FIX LỖI MẠNG CHO KHỐI CATCH
            return ContentService.createTextOutput(JSON.stringify({ success: false, message: err.toString() })).setMimeType(ContentService.MimeType.JSON);
        }
      case 'saveGlobalCache':
        try {
          const cacheName = "_vinhloc_global_cache.json";
          let files = DriveApp.getFolderById(CACHE_FOLDER_ID).searchFiles("title = '" + cacheName + "' and trashed = false");
          let cacheFile;
          if (files.hasNext()) {
            cacheFile = files.next();
            cacheFile.setContent(payload.cacheData);
          } else {
            cacheFile = DriveApp.getFolderById(CACHE_FOLDER_ID).createFile(cacheName, payload.cacheData, "application/json");
          }
          result = { success: true, message: "Đã lưu Não Nhện" };
        } catch(e) { result = { success: false, message: e.toString() }; }
        break;

      case 'loadGlobalCache':
        try {
          const cacheName = "_vinhloc_global_cache.json";
          let files = DriveApp.getFolderById(CACHE_FOLDER_ID).searchFiles("title = '" + cacheName + "' and trashed = false");
          if (files.hasNext()) {
            let cacheFile = files.next();
            let content = cacheFile.getBlob().getDataAsString();
            result = { success: true, data: JSON.parse(content) };
          } else {
            result = { success: false, message: "Chưa có Não Nhện" };
          }
        } catch(e) { result = { success: false, message: e.toString() }; }
        break;
      case 'list': result = getFolderContents(currentFolder); break;
      case 'createFolder':
        const newFolder = currentFolder.createFolder(payload.name);
        const realId = newFolder.getId();
        
        // 1. Ghi Description trực tiếp vào Folder Details trên Drive
        if (payload.description) {
          newFolder.setDescription(payload.description);
        }
        
        // 2. Nếu đây là Mega-row, TỰ ĐỘNG lưu ID thật vào Google Sheets ngay lập tức
        if (payload.isMegaRow) {
          updateMetaInSheet(
            realId,               // Đảm bảo 100% lưu ID thật
            payload.name,         // Tên thư mục
            payload.category,     // Loại (Ý tưởng/Triển khai)
            '',                   // Mô tả (để trống lúc mới tạo)
            ''                    // Ảnh cover (để trống lúc mới tạo)
          );
        }
        
        // Trả kết quả ID thật về cho giao diện web
        result = { success: true, id: realId, tempId: payload.tempId }; 
        break;
      case 'rename':
        if (payload.type === 'folder') DriveApp.getFolderById(payload.id).setName(payload.newName);
        else DriveApp.getFileById(payload.id).setName(payload.newName);
        result = { success: true }; break;
      case 'delete':
        if (payload.type === 'folder') DriveApp.getFolderById(payload.id).setTrashed(true);
        else DriveApp.getFileById(payload.id).setTrashed(true);
        result = { success: true }; break;
      case 'upload':
        const blobUpload = Utilities.newBlob(Utilities.base64Decode(payload.data), payload.mimeType, payload.filename);
        const newFile = currentFolder.createFile(blobUpload);
        result = { success: true, id: newFile.getId(), url: newFile.getUrl() }; break;
        // CHÈN THÊM CASE NÀY VÀO ĐỂ CẤP THẺ BÀI CHO TRÌNH DUYỆT
      case 'getToken':
        result = { success: true, token: ScriptApp.getOAuthToken() }; break;
      case 'makePublic':
        try {
          if (payload.type === 'folder') DriveApp.getFolderById(payload.id).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          else DriveApp.getFileById(payload.id).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          result = { success: true, message: "Đã tạo link công khai" };
        } catch(err) { result = { success: false, message: err.toString() }; } break;
      case 'getFileBase64':
        try {
          const file = DriveApp.getFileById(payload.fileId);
          const base64Data = Utilities.base64Encode(file.getBlob().getBytes());
          result = { success: true, data: base64Data, mimeType: file.getBlob().getContentType() };
        } catch(err) { result = { success: false, message: err.toString() }; } break;
      case 'globalSearch':
        result = { success: true, data: searchFilesAndFoldersGlobally(payload.keyword, ROOT_FOLDER_ID) }; break;
      case 'getMeta':
        result = { success: true, meta: getMetaFromSheet() }; break;
      case 'updateSingleMeta':
        updateMetaInSheet(payload.meta.id, payload.meta.name, payload.meta.type, payload.meta.desc, payload.meta.cover);
        
        try {
          // Bổ sung tính năng: Cập nhật lại Description trên Drive khi người dùng bấm Lưu sửa đổi
          let driveDesc = "";
          if (payload.meta.type) driveDesc += `[${payload.meta.type}]\n`;
          if (payload.meta.desc) driveDesc += payload.meta.desc;
          
          // Ghi đè mô tả mới vào Folder Details
          DriveApp.getFolderById(payload.meta.id).setDescription(driveDesc.trim());
        } catch(e) {
          // Bọc try-catch phòng trường hợp cập nhật thông tin của File (vì File dùng getFileById thay vì getFolderById)
        }
        
        result = { success: true, message: "Đã lưu vào Sheets và Drive" }; 
        break;
        
    }
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ----------------- SHEET FUNCTIONS (QUYỀN LỰC TỐI CAO) -----------------
function getMetaFromSheet() {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
    const data = sheet.getDataRange().getValues();
    let meta = {};
    for(let i = 1; i < data.length; i++) {
      let row = data[i];
      if(row[0]) meta[row[0]] = { name: row[1] || '', type: row[2] || 'Triển khai', desc: row[3] || '', cover: row[4] || '' };
    }
    return meta;
  } catch(e) { return {}; }
}

function updateMetaInSheet(id, name, type, desc, cover) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  const data = sheet.getDataRange().getValues();
  let found = false; const targetId = String(id).trim();
  for(let i = 1; i < data.length; i++) {
    if(String(data[i][0]).trim() === targetId) { 
      sheet.getRange(i + 1, 2, 1, 4).setValues([[name, type, desc, cover]]);
      found = true; break;
    }
  }
  if(!found) sheet.appendRow([targetId, name, type, desc, cover]);
}

// ----------------- DRIVE FUNCTIONS -----------------
function getFolderContents(folder) {
  let items = [];
  const folders = folder.getFolders();
  while (folders.hasNext()) {
    let f = folders.next();
    // KHÔNG lấy Description từ Drive nữa để tránh rác dữ liệu
    items.push({ id: f.getId(), name: f.getName(), type: 'folder' });
  }
  const files = folder.getFiles();
  while (files.hasNext()) {
    let f = files.next();
    items.push({ id: f.getId(), name: f.getName(), type: 'file', mimeType: f.getMimeType(), url: f.getUrl() });
  }
  items.sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name);
    return a.type === 'folder' ? -1 : 1;
  });
  return { success: true, data: items };
}

function searchFilesAndFoldersGlobally(keyword, rootId) {
  let items = []; const query = "title contains '" + keyword + "' and trashed = false";
  let folders = DriveApp.searchFolders(query);
  while(folders.hasNext() && items.filter(i => i.type === 'folder').length < 40) {
    let f = folders.next(); if (isDescendantOfRoot(f, rootId)) items.push({ id: f.getId(), name: f.getName(), type: 'folder' });
  }
  let files = DriveApp.searchFiles(query);
  while(files.hasNext() && items.filter(i => i.type === 'file').length < 50) {
    let f = files.next(); if (isDescendantOfRoot(f, rootId)) items.push({ id: f.getId(), name: f.getName(), type: 'file', mimeType: f.getMimeType(), url: f.getUrl() });
  }
  return items;
}
function isDescendantOfRoot(item, rootId) {
  if (item.getId() === rootId) return true; let current = item;
  while (true) { let parents = current.getParents(); if (!parents.hasNext()) return false; let parent = parents.next(); if (parent.getId() === rootId) return true; current = parent; }
}
function FORCE_AUTH() {
  DriveApp.getRootFolder();
  Logger.log(ScriptApp.getOAuthToken());
}
