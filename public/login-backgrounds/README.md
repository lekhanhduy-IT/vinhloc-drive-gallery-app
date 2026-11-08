# Hình nền đăng nhập QL Ảnh

Bộ ảnh ban đầu được tuyển chọn từ cây thư mục Google Drive **06. HÌNH ẢNH CONTENT** (nhánh Nhà máy), nhập trực tiếp vào repo ngày 09/11/2026.

- Ảnh toàn cảnh nhà xưởng, dây chuyền, thiết bị và nhóm kỹ thuật. Không chọn ảnh cận mặt một người.
- Ảnh JPEG gốc; chưa chuyển WebP hoặc tích hợp slideshow màn hình đăng nhập.
- Danh sách và tên ảnh nằm trong `backgrounds.json`. Đường dẫn tĩnh: `/login-backgrounds/<tên-file>`.
- Ảnh trong repo public và được Vercel phục vụ công khai; không đưa ảnh bảo mật vào thư mục này.
- Không có nhiệm vụ tự động đồng bộ mới, không tác động Google Drive gốc.

Sau này có thể tối ưu WebP và tạo carousel cho màn hình đăng nhập bằng cách đọc `backgrounds.json`.
