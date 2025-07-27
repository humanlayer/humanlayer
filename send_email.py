#!/usr/bin/env python3
import smtplib, sys
from email.mime.text import MIMEText

msg = MIMEText(sys.argv[2])
msg['Subject'] = sys.argv[1]
msg['To'] = '737a59ca2b3c@intake.linear.app'

with smtplib.SMTP('localhost') as s:
    s.send_message(msg)