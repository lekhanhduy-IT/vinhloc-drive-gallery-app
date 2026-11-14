# Hình nền đăng nhập QL Ảnh

Bạn có thể **tự tải ảnh** (PNG, JPG, JPEG, WebP, AVIF) vào thư mục `public/login-backgrounds/`.

- Hiện có 11 ảnh. Khi deploy, `npm run build` tự quét các file ảnh và tạo lại `backgrounds.json`; không cần thêm từng file bằng tay.
- Trang đăng nhập lấy danh sách trong `backgrounds.json`, **xáo trộn thứ tự** và **chuyển ảnh sau mỗi 8,5 giây** bằng hiệu ứng mờ.
- Trên điện thoại, ảnh tập trung phía trên; phần dưới trắng dần để nút Google và thông tin đăng nhập dễ đọc.
- Ảnh tiếp theo chỉ tải sau khi ảnh trước xuất hiện; khi tab ẩn hoặc đã đóng màn hình đăng nhập sẽ tạm dừng.
- Nếu không có ảnh hoặc ảnh lỗi, màn hình đăng nhập vẫn hiển thị nền trắng và hoạt động bình thường.
- Ảnh thuộc `public` được truy cập công khai. Không đưa dữ liệu riêng tư vào đây.
- Không có đồng bộ ảnh từ Google Drive.

Các file được thêm trên GitHub cần một lượt build/deploy mới để xuất hiện trong danh sách.
