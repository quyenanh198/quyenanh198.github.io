---
layout: base.njk
title: Contact
permalink: /contact/
---
# Contact

<ul class="social-links">
  <li>Email: <a href="mailto:{{ site.email }}">{{ site.email }}</a></li>
  {% for item in site.social %}
  <li>{{ item.text }}: <a href="{{ item.url }}">{{ item.url }}</a></li>
  {% endfor %}
</ul>
