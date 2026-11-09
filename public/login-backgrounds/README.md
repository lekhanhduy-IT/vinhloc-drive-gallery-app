# Hình nền đăng nhập QL Ảnh

Tải các ảnh PNG, JPG, JPEG, WebP hoặc AVIF vào `public/login-backgrounds/` và commit lên GitHub. Sau khi Vercel build lại, toàn bộ ảnh trong thư mục được tự động đưa vào danh sách.

**Mỗi lần mở app:** `bootstrap.js` chọn ngẫu nhiên ảnh đầu tiên từ toàn bộ kho trước khi giao diện đăng nhập hiển thị; không hiện ảnh mặc định rồi nhảy qua ảnh khác.

**Mỗi lần đăng xuất/trở lại đăng nhập:** chọn ngẫu nhiên ảnh khác, và xáo trộn thứ tự mới. Sau đó ảnh chuyển **từng tấm cách nhau ít nhất 8,5 giây**, mờ dần trong 1,15 giây khi được phép chuyển động.

`backgrounds.json` và `bootstrap.js` được tạo lại bằng `npm run build` (prebuild), không cần sửa mã nguồn hoặc thêm thủ công từng tên ảnh. Khi thêm/xóa ảnh cần một lần commit và deploy mới.

Hình nền chỉ hiển thị một ảnh `cover` toàn màn hình, giữ tỷ lệ ảnh, không thêm lớp trắng hoặc mờ phụ.
