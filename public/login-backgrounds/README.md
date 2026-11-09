# Kho ảnh nền đăng nhập QL Ảnh

Đặt ảnh PNG vào `public/login-backgrounds/` và push lên GitHub. Lệnh build tạo lại `backgrounds.json` và đưa **ảnh xem trước nhỏ của từng ảnh thật** vào HTML kết quả. Đường dẫn ảnh gốc có fingerprint SHA-256 để khi ghi đè nội dung ảnh, thiết bị dùng phiên bản ảnh mới.

**Lần mở đầu trên thiết bị mới:** HTML chứa ảnh xem trước nên hình nền ngẫu nhiên có thể được vẽ ngay trong lần dựng giao diện đầu, không đợi tải ảnh gốc lớn. Ảnh gốc được tải và giải mã rồi mới thay thế ảnh xem trước. Không có màn hình nền màu trống nếu bản build hợp lệ.

**Các lần tiếp theo:** Service Worker `/login-photos-sw.js` chỉ cache ảnh `/login-backgrounds/`; nó không cache HTML, API hay thông tin đăng nhập. Tải dần 11 ảnh qua hai kết nối khi ứng dụng đang mở, rồi dùng cache-first ở các lần mở sau. Việc này tốn dữ liệu khoảng 19 MB một lần cho mỗi thiết bị khi cache chưa có. Một thiết bị mới không thể dùng trực tiếp bộ nhớ cache của thiết bị khác; nó vẫn cần tải lần đầu. Trình duyệt/iOS có thể xóa cache khi thiếu dung lượng hoặc khi người dùng xóa dữ liệu.

Giữ tỷ lệ ảnh `cover`, vị trí `center 25%`, GIF, nút Google, chu kỳ chuyển 8,5 giây và chuyển mờ 1,15 giây của phiên bản 3.1.54.

Build sẽ thất bại nếu HTML cuối cùng không chứa ảnh PNG xem trước. Hiện hỗ trợ ảnh PNG để tạo preview; các định dạng khác cần bổ sung bộ giải mã trước khi đưa vào kho.
