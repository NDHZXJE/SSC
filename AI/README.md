# AI: mô hình hiệu chuẩn hybrid-1

- `ssc_sim.py`: giả lập cục SSC (nhiệt độ, độ ẩm, lão hoá, cục đối chứng).
- `experiment.py`: so sánh 8 phương pháp trên dữ liệu giả lập, ghi `results.json`.
- `train.py`: huấn luyện từ file Excel theo template, ghi `models.json`. `python train.py du_lieu.xlsx`
- `make_templates.py`: tạo `SSC_template_du_lieu.xlsx` (trống) và `SSC_template_mau_gia_lap.xlsx` (mẫu).

Mã mô hình dùng trên server nằm ở `Server/api/app/hybrid.py`.
