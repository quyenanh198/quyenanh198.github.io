---
layout: base.njk
title: About
permalink: /about/
---
# Về trang này

Xin chào, tôi là Quyền Anh. Đây là site cá nhân của tôi — vừa là blog, vừa là một
**nền tảng phân tích thị trường chứng khoán Mỹ tự vận hành**: toàn bộ báo cáo và bài
phân tích trên trang được tạo tự động theo lịch, không cần can thiệp thủ công.

## Trang này có gì

- **[Tra cứu ticker](/lookup/)** — gõ bất kỳ mã cổ phiếu/ETF Mỹ nào để xem biểu đồ nến
  kiểu TradingView (khung 5 phút → 10 năm) với bộ chỉ báo tùy chỉnh (SMA, EMA, Bollinger,
  Ichimoku, RSI, Stochastic, MACD, hỗ trợ/kháng cự, gợi ý Entry/SL), kèm bài phân tích
  đa khung thời gian viết tự động ngay dưới biểu đồ.
- **[Reports](/reports/)** — báo cáo định kỳ: tổng hợp thị trường tuần/tháng, dòng tiền
  luân chuyển giữa 11 nhóm ngành S&P 500, và theo dõi danh mục ticker.
- **[Blog](/blog/)** — mỗi cuối tuần và đầu tháng, hệ thống tự viết một bài phân tích
  tổng hợp (xu hướng, dòng tiền, điểm nhấn watchlist, các mốc cần quan sát) và đăng
  tại đây.

## Cách nó hoạt động

Site là trang tĩnh build bằng [Eleventy](https://www.11ty.dev/), chạy trên GitHub Pages.
GitHub Actions chạy theo lịch, lấy dữ liệu giá từ các nguồn công khai, tính toán chỉ báo
kỹ thuật, rồi **viết báo cáo bằng máy phân tích theo luật** — mọi con số đều đến từ dữ
liệu thật. Trang tra cứu lấy dữ liệu trực tiếp trên trình duyệt qua một Cloudflare Worker
riêng. Mã nguồn mở hoàn toàn tại
[github.com/quyenanh198/quyenanh198.github.io](https://github.com/quyenanh198/quyenanh198.github.io).

## Miễn trừ trách nhiệm

Mọi nội dung phân tích, nhận định và vùng giá gợi ý trên trang được tạo tự động từ dữ
liệu thị trường, **chỉ nhằm mục đích thông tin và học tập — không phải khuyến nghị đầu
tư**. Hãy tự nghiên cứu và chịu trách nhiệm với quyết định của mình.

## Liên hệ

Xem trang [Contact](/contact/), hoặc email
[quyenanh198@gmail.com](mailto:quyenanh198@gmail.com).
