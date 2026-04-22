UPDATE whatsapp_templates
SET body = 'مرحباً {{full_name}}،\nنرحب بك في خدمتنا.\nتم تفعيل اشتراكك بنجاح.\n\n• اسم المستخدم: {{username}}\n• كلمة المرور: {{password}}\n• الباقة: {{package_name}}\n• السرعة: {{speed}}\n• تاريخ الانتهاء: {{expiration_date}}\n\nنتمنى لك تجربة ممتعة.'
WHERE template_key = 'new_account';

UPDATE whatsapp_templates
SET body = 'مرحباً {{full_name}}،\nتنبيه باقتراب انتهاء اشتراكك.\nالمتبقي: {{days_left}} يوم.\n\n• الباقة: {{package_name}}\n• السرعة: {{speed}}\n• تاريخ الانتهاء: {{expiration_date}}\n\nيرجى التجديد قبل انتهاء الاشتراك لضمان استمرار الخدمة.'
WHERE template_key = 'expiry_soon';
