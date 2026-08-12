---
layout: base.njk
title: Contact
permalink: /contact/
---
<div class="page-header">
<span class="eyebrow">Contact</span>
</div>

# Get in touch

<ul class="social-links">
  <li><span class="label">Email</span> <a href="mailto:{{ site.email }}">{{ site.email }}</a></li>
  {% for item in site.social %}
  <li><span class="label">{{ item.text }}</span> <a href="{{ item.url }}">{{ item.url }}</a></li>
  {% endfor %}
</ul>
