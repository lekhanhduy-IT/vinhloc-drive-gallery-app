# Hình nền đăng nhập QL Ảnh

Thêm ảnh JPG, JPEG, PNG, WebP hoặc AVIF vào thư mục `public/login-backgrounds/`. Lúc build, script `scripts/generate-login-backgrounds.mjs` cập nhật tự động `backgrounds.json`, không cần sửa danh sách thủ công.

Cơ chế hình nền được giữ nguyên như bản 3.1.54: ảnh mặc định gắn trực tiếp trong HTML và được hiển thị ngay khi trình duyệt tải xong ảnh đó. Chỉ có **một lớp ảnh nền chính** và **một lớp chuyển mờ** đã có sẵn; không có ảnh xem trước, bootstrap động, ảnh lặp hoặc lớp lọc mới.

Sau mỗi lần mở màn hình đăng nhập, hệ thống **xáo trộn thứ tự các ảnh trong vòng luân phiên**, không chuyển ảnh liên tục khi khởi động. Chu kỳ 8,5 giây, chuyển mờ 1,15 giây trên thiết bị không bật giảm chuyển động.

Để bảo đảm không làm xuất hiện màu nền trống hoặc nhảy ảnh khi khởi động, ảnh đầu tiên đang dùng ảnh mặc định gắn trong HTML. Các ảnh ở lượt tiếp theo được xáo trộn ngẫu nhiên. Chọn ngẫu nhiên ảnh đầu tiên trên một thiết bị mới chưa có bộ nhớ đệm sẽ yêu cầu thay đổi cơ chế tải ảnh; không thực hiện trong bản sửa này.

Sau khi tải ảnh mới lên GitHub và Vercel triển khai, danh sách ảnh nền tự cập nhật.
