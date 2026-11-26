# SSC: bê tông tự cảm biến

Hệ thống đo, hiệu chuẩn và giám sát các cục bê tông tự cảm biến (SSC).

| Thư mục | Nội dung |
|---|---|
| `Server/` | Server (FastAPI + TimescaleDB + Mosquitto + web React), chạy bằng `docker compose up -d --build`. Hướng dẫn trong `Server/README.md`. |
| `AI/` | Mô hình AI hiệu chuẩn "hybrid-1": bộ giả lập, so sánh phương pháp, huấn luyện từ file Excel, template dữ liệu. |
| `Device/` | Sơ đồ phần cứng (ESP32-S3 + ADS1256). |
| `Material/` | Bài báo tham khảo (không đưa lên GitHub). |

Chạy nhanh:
```
cd Server
copy .env.example .env      # rồi sửa mật khẩu, khoá Gemini
docker compose up -d --build
```
Mở http://localhost:8000. Trang **Nhập dữ liệu** để nhập số liệu thí nghiệm (có trợ lý AI), trang **Hiệu chuẩn** để huấn luyện mô hình cho từng cục.

Huấn luyện ngoài server:
```
cd AI
pip install numpy pandas openpyxl
python train.py SSC_template_mau_gia_lap.xlsx
```
