# SSC Monitor – server, cơ sở dữ liệu và web

Hệ thống nhận tín hiệu từ các node ESP32 đo cục bê tông tự cảm biến (SSC), lưu 100 mẫu/giây,
hiệu chuẩn từng cục và hiển thị trên web.

```
Node ESP32 ──MQTT──> Mosquitto ──> API (FastAPI) ──> PostgreSQL + TimescaleDB
                                        │
                                        └──> Web (React)   Jupyter (thử AI)
```

## Chạy trên máy chủ

Cần Docker và Docker Compose (Windows: Docker Desktop, Linux: docker-ce).

```bash
cd Server
cp .env.example .env        # đổi mật khẩu trong .env
docker compose up -d --build
```

- Web: `http://<ip-máy-chủ>:8000`, đăng nhập bằng `ADMIN_USER` / `ADMIN_PASSWORD` trong `.env`.
- MQTT cho node: `<ip-máy-chủ>:1883`.
- Thử khi chưa có phần cứng: `docker compose --profile sim up -d` (3 node giả lập, 100 mẫu/giây).
- Jupyter để thử AI: `docker compose --profile ai up -d`, mở `http://<ip-máy-chủ>:8888` (token trong `.env`).

## Quy trình dùng

1. **Quản trị → Thêm cục**: mã cục, cấp phối (F2), diện tích điện cực A, khoảng cách L, diện tích chịu nén.
2. **Thiết bị → Thêm mạch đọc**: bật mạch, nhập mã 6 số hiện trên mạch để ghép. Gán mạch cho cục và nhập R1 đo thực bằng đồng hồ
   (có thể làm ngay lúc ghép). Mạch chưa ghép không hiện trong danh sách và không ghi dữ liệu.
   Cập nhật firmware cho mạch: **Thiết bị → Firmware (OTA)**, tải file `.bin` lên rồi chọn mạch để nạp.
3. **Hiệu chuẩn**: chọn cục → Bắt đầu lần mới → đặt cục lên máy nén. Ở mỗi bậc tải, nhập lực (kN) và bấm
   **Ghi bậc** (lấy trung bình ρ vài giây gần nhất) → **Khớp mô hình** → kiểm tra R² → **Duyệt và dùng**.
   Không có máy nén: **Tạo nhanh từ Eq.14** (đo ρ(0) lúc không tải, lấy K theo Eq. 14 của bài Measurement 2026).
4. **Tổng quan / trang cục**: trạng thái online, ρ, σ, tải (kN) trực tiếp, lịch sử, xuất CSV/Parquet.

## Định dạng gói MQTT (firmware phải gửi đúng)

`ssc/<id-thiết-bị>/data`, mỗi giây 1 gói, QoS 0:

```json
{"seq": 12, "t0": 1764150000000, "dt_ms": 10,
 "us": [2.8165, 2.8171, ...100 giá trị, V],
 "up": 16.02,
 "temp": 28.4, "rh": 61.0}
```

- `t0`: thời điểm mẫu đầu tiên (ms, epoch UTC, đồng bộ NTP). `dt_ms`: 10 ms ứng với 100 mẫu/giây.
- `us`: điện áp hai đầu SSC (V) đã quy đổi qua hệ số chia áp. `up`: điện áp nguồn (V), một số hoặc mảng 100 giá trị.
- `ssc/<id>/status` (retained, đặt làm LWT với `{"online": false}`): `{"online": true, "fw": "0.1.0", "ip": "...", "rssi": -58}`.
- Server gửi cấu hình xuống `ssc/<id>/config` (retained).

### Ghép mạch bằng mã 6 số

1. Khi chưa ghép, firmware tạo một mã 6 số, hiện cho người dùng (màn hình, đèn/nhãn dán hoặc Serial Monitor)
   và gửi kèm trong gói status: `{"online": true, "fw": "...", "ip": "...", "rssi": -58, "pair": "482913"}`.
2. Firmware subscribe `ssc/<id>/pair`. Quản trị nhập đúng mã ở trang **Thiết bị → Thêm mạch đọc**, server gửi
   `{"paired": true}` (retained) lên topic này. Firmware thôi hiện mã và gửi lại status không có `pair`.
3. Bỏ ghép (nút **Bỏ ghép** trên web): server xoá tin retained trên `ssc/<id>/pair` (gói rỗng), firmware hiện lại mã.

Mã chỉ có hiệu lực khi mạch đang online. Nhập sai 10 lần trong 10 phút thì server tạm khoá. Gợi ý cho firmware ESP32:
mã cố định theo MAC để in được nhãn dán, ví dụ `uint32_t code = (uint32_t)(ESP.getEfuseMac() * 2654435761ULL % 1000000ULL);`
rồi `snprintf(buf, 7, "%06u", code)`.

### Nạp firmware OTA qua server

Trang **Thiết bị → Firmware (OTA)** (quản trị):

1. `idf.py build` rồi tải lên `build/esp32s3-meter.bin` (ảnh app, không phải `bootloader.bin` hay `.elf`). Server đọc
   `esp_app_desc_t` trong ảnh để lấy phiên bản (`PROJECT_VER` trong `CMakeLists.txt`), tên dự án, chip, ngày build.
   Nhớ tăng `PROJECT_VER` mỗi lần build bản mới, server dựa vào nó để biết mạch đã lên bản mới chưa.
2. Bấm **Nạp…**, chọn mạch (mặc định chọn các mạch online chưa chạy bản này), **Nạp cho N mạch**. Cột Firmware hiện
   tiến độ tải, rồi "đang khởi động lại", rồi "Đã nạp".

Giao thức (firmware `ssc-1.1.0` trở lên, xem `Device/firmware/components/ssc_node/ssc_ota.c`):

- Firmware báo `"ota": 1` trong gói status. Bản cũ hơn (không có cờ này) phải nạp bằng cáp hoặc `POST /update` một lần.
- Server → `ssc/<id>/ota` (QoS 1, không retained):
  `{"job": "a1b2c3d4", "url": "/api/ota/<token>", "version": "ssc-1.1.0", "size": 1201504, "sha256": "..."}`.
  `url` bắt đầu bằng `/` thì mạch tải từ `http://<máy chủ trong địa chỉ MQTT>:8000<url>`. Đặt `OTA_BASE_URL` trong
  `.env` (vd `https://ssc.example.com`) để gửi địa chỉ đầy đủ. Token chỉ dùng được trong lúc lần nạp đó đang chạy.
- Mạch → `ssc/<id>/ota/state`: `{"job": "...", "state": "downloading|rebooting|error|rejected", "pct": 40, "msg": "..."}`.
- Mạch từ chối ảnh khác chip hoặc khác tên dự án, và ảnh hỏng (`esp_ota_end` kiểm tra SHA-256 gắn trong ảnh).
- Sau khi khởi động lại, bản mới chỉ được giữ nếu kết nối được MQTT trong 5 phút; không thì mạch tự quay về bản cũ
  (rollback) và web báo "bản mới bị trả về bản cũ". Lần nạp không phản hồi quá 3–10 phút thì web báo lỗi, nạp lại được.

Thử không cần mạch thật: bộ giả lập (`--profile sim`) cũng nhận lệnh OTA, tải ảnh thật, kiểm tra sha256 rồi báo phiên bản mới.

## Cách tính

| Bước | Công thức |
| --- | --- |
| Điện trở SSC | Rs = R1·Us / (Up − Us) |
| Điện trở suất | ρ = Rs·A / L |
| ρ(0) theo môi trường | ρs0(0)·exp(1.2α(T − 20) + 0.9β(W − 0)), α, β theo Eq. 12–13 |
| K theo môi trường | K hiệu chuẩn × K_Eq14(ρ(0) hiện tại) / K_Eq14(ρ(0) lúc hiệu chuẩn) |
| Ứng suất, tải | σ = (ρ − ρ(0)) / K, tải = σ × diện tích chịu nén |

Mã nguồn công thức: `api/app/model.py`.

## Dữ liệu cho AI

- Web: nút xuất CSV/Parquet ở trang từng cục.
- Python: `notebooks/ssc_data.py` có `sensors()`, `samples(code, start, end, resolution)`, `calib_steps()`.
- Bảng `calib_steps` là dữ liệu có nhãn (σ thật từ máy nén) để huấn luyện mô hình phần dư.

## Phát triển

```bash
# API (cần PostgreSQL và một MQTT broker chạy sẵn)
cd api && pip install -r requirements.txt
DATABASE_URL=postgresql://ssc:ssc@localhost:5432/ssc uvicorn app.main:app --reload
# Web
cd web && npm install && npm run dev     # http://localhost:5173, gọi API qua proxy
# Node giả lập
python simulator/sim.py --devices 2 --load-file tai.txt   # sửa số kN trong tai.txt để thử hiệu chuẩn
```

API có tài liệu tự động tại `/docs`.

## Mô hình AI lai (hiệu chuẩn, dự đoán, kiểm tra trôi)

Mã: `api/app/hybrid.py` (mô hình), `api/app/dataset.py` (template Excel), `api/app/ai_api.py` (API).
Thiết kế và kết quả thử trên dữ liệu giả lập: tài liệu "Thiết kế model AI hiệu chuẩn bê tông tự cảm biến".

Trên web, trang **Hiệu chuẩn** có thêm thẻ **Mô hình AI lai**:

1. **Dữ liệu**: tải template Excel trống, nhập file đã điền, hoặc xuất toàn bộ dữ liệu đã thu theo đúng mẫu đó.
2. **Cục đối chứng**: đánh dấu cục không tải, hoặc chọn cục đối chứng đi kèm cục đo.
3. **Quét nhiệt**: đặt cục không tải trong tủ nhiệt, ở mỗi mức bấm **Ghi mức nhiệt**.
4. **Huấn luyện**: dùng mọi bậc ép đã ghi ở trên và các mức nhiệt, rồi bấm **Duyệt**.
5. **Mốc lắp đặt**: sau khi đặt cục vào công trình, trước khi cho tải, bấm **Đặt mốc lắp đặt**.
6. **Kiểm chứng và trôi**: ghi các lúc biết chắc tải. Server tự kiểm tra trôi 6 giờ một lần.

Khi mô hình lai đang dùng, mỗi mẫu có `stress`, `stress_lo`, `stress_hi` (khoảng tin cậy 95%).
API `/api/sensors/{id}/live` trả thêm `flag`: `ok`, `prior` (chưa ép), `no_zero` (chưa đặt mốc),
`no_reference` (cục đối chứng mất tín hiệu), `out_of_range`.

| API | Việc |
| --- | --- |
| `GET /api/ai/template.xlsx` | Template trống |
| `POST /api/ai/import` | Nhập template đã điền (multipart, trường `file`) |
| `GET /api/ai/dataset.xlsx` | Xuất dữ liệu huấn luyện đã thu |
| `POST /api/calib/temp-steps` | Ghi một mức quét nhiệt từ tín hiệu trực tiếp |
| `POST /api/sensors/{id}/models/hybrid` | Huấn luyện phiên bản mới (chưa dùng tới khi duyệt) |
| `POST /api/sensors/{id}/install-zero` | Đặt mốc lắp đặt |
| `POST /api/sensors/{id}/field-checks` | Ghi điểm kiểm chứng |
| `POST /api/sensors/{id}/drift` | Kiểm tra trôi |
| `POST /api/ai/fleet` | Tính lại prior cấp phối từ các cục đã hiệu chuẩn |
| `GET /api/ai/evaluate` | Sai số trên các điểm kiểm chứng |

Huấn luyện ngoài server (Jupyter hoặc máy riêng): `python ../ai/train.py du_lieu.xlsx`.

### Trang "Nhập dữ liệu" (web, quản trị)
Menu **Nhập dữ liệu** (`#/data`) cho nhập dữ liệu huấn luyện ngay trên web, cùng cột với template Excel:
Cục mới, Quét nhiệt, Ép theo bậc (tay / dán từ Excel / lấy từ node / từ file điện áp ESP32), Mốc lắp đặt, Kiểm chứng.
Có bước kiểm tra trước khi lưu, danh sách dữ liệu đã lưu và nút xoá. API: `POST /api/ai/rows`, `GET /api/ai/rows?sheet=&sensor_id=`,
`DELETE /api/ai/rows/{sheet}/{id}`, `GET /api/sensors/{id}/now?window_s=` (trung bình ρ, nhiệt độ, ρ đối chứng gần nhất).

### Trợ lý AI ở trang Nhập dữ liệu
Ô "Bối cảnh thí nghiệm" + khung chat: người dùng mô tả thí nghiệm và kể/dán số liệu, trợ lý chọn loại dữ liệu và điền sẵn vào form
(không tự lưu; người dùng xem mục Kiểm tra rồi bấm Lưu). Bối cảnh và hội thoại được lưu vào bảng `experiment_notes`.
- Mặc định dùng Gemini (AI_CHAT_PROVIDER=openai, cần LLM_API_KEY). Muốn chạy model nhỏ ngay trên máy chủ thì đặt `AI_CHAT_PROVIDER=ollama`, chạy `docker compose --profile ollama up -d` rồi `docker compose exec ollama ollama pull qwen2.5:7b`.
  Máy chậm thì dùng `OLLAMA_MODEL=qwen2.5:3b`.
- Hoặc dùng Claude API: đặt `AI_CHAT_PROVIDER=claude` và `ANTHROPIC_API_KEY` trong `.env` (model mặc định `claude-haiku-5-5`, đổi bằng `CLAUDE_MODEL`).
- Hoặc dùng API miễn phí kiểu OpenAI, ví dụ Google Gemini: lấy khoá ở https://aistudio.google.com/apikey rồi đặt trong `.env`:
  `AI_CHAT_PROVIDER=openai`, `LLM_API_KEY=<khoá>`, `LLM_MODEL=gemini-3.5-flash-lite` (`LLM_BASE_URL` mặc định là Gemini).
  Groq: `LLM_BASE_URL=https://api.groq.com/openai/v1`, `LLM_MODEL=llama-3.3-70b-versatile`. Sau đó `docker compose up -d api`.
  Lưu ý bản miễn phí có giới hạn số lượt mỗi phút/ngày, và nhà cung cấp có thể dùng dữ liệu gửi lên để cải thiện sản phẩm.
- API: `GET /api/ai/assistant` (model đang dùng), `POST /api/ai/assistant` {context, messages, form}.
