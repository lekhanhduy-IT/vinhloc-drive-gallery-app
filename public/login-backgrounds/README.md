# Hình nền đăng nhập QL Ảnh

Thêm ảnh JPG, JPEG, PNG, WebP hoặc AVIF vào thư mục `public/login-backgrounds/`. Lúc build, script `scripts/generate-login-backgrounds.mjs` cập nhật tự động `backgrounds.json`, không cần sửa danh sách thủ công.

Cơ chế hình nền được giữ nguyên như bản 3.1.54: ảnh mặc định gắn trực tiếp trong HTML và được hiển thị ngay khi trình duyệt tải xong ảnh đó. Chỉ có **một lớp ảnh nền chính** và **một lớp chuyển mờ** đã có sẵn; không có ảnh xem trước, bootstrap động, ảnh lặp hoặc lớp lọc mới.

Sau mỗi lần mở màn hình đăng nhập, hệ thống **xáo trộn thứ tự các ảnh trong vòng luân phiên**, không chuyển ảnh liên tục khi khởi động. Chu kỳ 8,5 giây, chuyển mờ 1,15 giây trên thiết bị không bật giảm chuyển động.

Ảnh đầu tiên được chọn ngẫu nhiên ngay trong HTML trước khi màn hình đăng nhập được vẽ. Danh sách được tạo lại từ kho ảnh lúc build. Khi đăng xuất, hệ thống sử dụng ảnh ngẫu nhiên đã tải sẵn nếu có. Không dùng ảnh xem trước hoặc hiệu ứng mới.

Sau khi tải ảnh mới lên GitHub và Vercel triển khai, danh sách ảnh nền tự cập nhật.
