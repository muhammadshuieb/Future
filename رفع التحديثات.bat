@echo off
cd /d "C:\Users\HP\OneDrive\سطح المكتب\Future Radius"
git pull origin main
git add .
git commit -m "Auto update from local machine"
git push origin main
