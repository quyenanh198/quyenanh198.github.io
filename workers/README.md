# Market proxy — Cloudflare Worker

Proxy dữ liệu thị trường cho trang `/lookup/`. Giải quyết việc trình duyệt bị chặn CORS khi
gọi thẳng Yahoo Finance, thay cho các CORS proxy công cộng kém ổn định, và (tùy chọn) giấu
Alpha Vantage API key để lấy nến 1 phút lịch sử sâu.

Miễn phí: gói Free của Cloudflare Workers cho 100.000 request/ngày — quá thừa cho nhu cầu cá nhân.

## Deploy (~10 phút, không cần cài gì)

1. Tạo tài khoản miễn phí tại https://dash.cloudflare.com (chỉ cần email, không cần thẻ).
2. Vào **Workers & Pages** → **Create** → **Create Worker**.
3. Đặt tên, ví dụ `market-proxy` → bấm **Deploy** (deploy bản mẫu trước, sửa code sau).
4. Bấm **Edit code**, xóa toàn bộ code mẫu, dán toàn bộ nội dung file
   [`market-proxy.js`](./market-proxy.js) vào → **Save and deploy**.
5. Copy URL của worker, dạng: `https://market-proxy.<tên-tài-khoản>.workers.dev`
6. Kiểm tra nhanh: mở
   `https://market-proxy.<tên-tài-khoản>.workers.dev/chart?symbol=AAPL&interval=1d&range=1mo`
   trên trình duyệt — thấy JSON giá là thành công.
7. Mở `src/_data/site.json` trong repo này, điền URL vào trường `"marketProxy"`, commit lên
   `master` (hoặc đưa URL cho Claude làm giúp). Trang `/lookup/` sẽ tự ưu tiên gọi worker.

## Tùy chọn: bật nến 1 phút lịch sử sâu (Alpha Vantage)

1. Lấy API key miễn phí tại https://www.alphavantage.co/support/#api-key (25 request/ngày).
2. Trong trang worker trên Cloudflare: **Settings** → **Variables and Secrets** →
   **Add** → Type: **Secret**, tên `ALPHAVANTAGE_KEY`, giá trị là key của bạn → **Deploy**.
3. Endpoint `/av` sẽ hoạt động, ví dụ:
   `/av?function=TIME_SERIES_INTRADAY&symbol=AAPL&interval=1min&month=2020-03&outputsize=full`
   Worker tự cache các tháng lịch sử trong 7 ngày để tiết kiệm quota 25 request/ngày.

## Bảo mật

- Worker chỉ nhận GET và chỉ có 2 endpoint `/chart`, `/av`; tham số được kiểm tra chặt
  (symbol/interval/range/function nằm trong danh sách cho phép) — không thể bị lợi dụng làm
  open proxy.
- CORS mặc định chỉ cho phép `https://quyenanh198.github.io`. Muốn thêm origin (ví dụ máy
  local khi dev), đặt biến `ALLOWED_ORIGINS` = danh sách origin cách nhau dấu phẩy.
- Alpha Vantage key chỉ nằm trong Secret của worker, không bao giờ xuất hiện ở phía trình duyệt.
