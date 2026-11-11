# Upload nền native — Vĩnh Lộc Drive

## Phạm vi triển khai

- **Android native:** `VLBackgroundUploadPlugin` dùng `ACTION_OPEN_DOCUMENT` và giữ quyền đọc URI. Khi người dùng chọn file, service `VLUploadService` được khởi chạy ngay, tiếp nhận hàng đợi, tạo phiên upload bằng cookie phiên xác thực, sao chép dữ liệu vào vùng riêng **không sao lưu** của app và upload lên Google Drive bằng resumable PUT 5 MiB/chunk. Dữ liệu hàng đợi và phiên Drive được lưu dưới `noBackupFilesDir`. Tiến độ được xác minh bằng `inspectUpload` trên máy chủ. Foreground notification hiển thị khi upload.
- **iOS native:** Có mã nguồn Swift cho `UIDocumentPicker`, staging vào Application Support và `URLSessionConfiguration.background` dùng `uploadTask(fromFile:)`. Cần tạo dự án iOS bằng Xcode, thêm mã nguồn Swift và tích hợp AppDelegate; xem `native/ios/README.md`.
- **Web/PWA/desktop:** Không thay đổi luồng `src/upload-reliable.js`. Web không bảo đảm upload khi tab bị đóng băng hoặc trình duyệt bị hệ điều hành đình chỉ.

## Điều kiện sử dụng

- Native phải chạy WebView từ đúng máy chủ **HTTPS cùng nguồn gốc với phiên đăng nhập có cookie `vl_verified_media`** (plugin kiểm tra HTTPS origin trùng URL WebView). Biến build `VITE_VL_UPLOAD_API_ORIGIN` chỉ chỉ định URL máy chủ, không tự tạo phiên đăng nhập trên domain đó. Khi WebView chỉ chạy tài nguyên offline `localhost`, phải cấu hình xác thực web/API thực tế trước khi bật native upload.
- Người dùng phải đăng nhập Google và có quyền trong thư mục Drive; `/api/owned-files` sẽ đối chiếu `expectedOwner` với email **đã xác thực** để bảo toàn tài khoản upload, ngăn thiết bị nhận việc ghi đè thông tin sở hữu.
- Đây là **provenance** trong Drive `appProperties.vlUploadedBy` (tài khoản người yêu cầu upload), không phải thay đổi trường `owners` do Google Drive quản lý. Shared Drive quản lý quyền sở hữu theo chính sách của Drive.
- Mỗi file có `vlUploadKey` duy nhất. API `confirmUpload` và `inspectUpload` kiểm tra chống trùng trước/sau upload.

## Kiểm thử bắt buộc trước khi triển khai

1. Trên Android thật: chọn 10 ảnh + 2 video, vừa quay về app vừa chuyển sang app khác và khóa màn hình; kiểm tra thông báo và tiến độ trên Drive.
2. Mất mạng rồi có mạng lại; xác nhận không có file trùng. Sau 5 lần lỗi liên tiếp service tạm dừng; mở lại app để tiếp tục hàng đợi.
3. Đổi tài khoản Google giữa chừng; upload của A không được tự nhận thành tài khoản B.
4. Thử chuyển qua folder khác trong khi đang tải; file phải nằm trong folder đã chọn ban đầu.
5. Kiểm tra quyền truy cập thư mục chia sẻ và trường `vlUploadedBy` trong appProperties.
6. iOS: sau khi tích hợp trong Xcode, kiểm tra background URLSession với thiết bị thật. Force-quit iOS có thể dừng tác vụ; đừng hứa tiếp tục tuyệt đối.

## Giới hạn hệ điều hành

Android dataSync foreground service chạy được khi người dùng chuyển app hoặc tắt màn hình nhưng Android 15+ giới hạn **6 giờ trong 24 giờ** đối với app target 35+. Hệ điều hành vẫn có thể hủy tác vụ, người dùng có thể Force stop app; không có cam kết tuyệt đối. iOS yêu cầu **file-backed** URLSession background tasks và bắt buộc hoàn tất staging trước khi ứng dụng bị đình chỉ. Không thể lấy file chưa được Android/iOS cấp quyền đọc chỉ từ thiết bị khác.

## Bảo mật

- Không đưa Drive OAuth bearer token vào URL hay lưu trong máy. Trình native lấy session URL thông qua API nội bộ có xác thực rồi gửi trực tiếp tới Drive.
- Session URL là một khả năng truy cập; lưu riêng dưới vùng không backup và không log.
- Đừng triển khai client HTTPS origin từ giá trị tùy tiện hoặc cho phép upload thay một email khác với phiên máy chủ.
