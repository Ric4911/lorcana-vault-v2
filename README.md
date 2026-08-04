# Lorcana Vault PWA

A Windows-friendly installable iPhone web app for organising Disney Lorcana cards.

## What it does
- Add/edit/search cards
- Track binder/page/slot or box/row locations
- Track quantity, foil quantity, condition, trade list, and price per card
- Collection value dashboard
- CSV import/export and JSON backup
- iPhone camera/photo scanner with in-browser OCR
- Automatic card matching and form fill using the Lorcast card database
- Offline use after first load

## Install on iPhone without a Mac
1. Upload this folder to HTTPS hosting. Free options include Netlify, Vercel, GitHub Pages, or Cloudflare Pages.
2. Open the hosted URL in Safari on your iPhone.
3. Tap Share > Add to Home Screen.

Camera access requires HTTPS on iPhone Safari.

The first OCR scan needs an internet connection to download the recognition engine. After it has been cached, later scans can work offline; automatic card matching needs a connection.

## Important note on value/pricing
This MVP stores manual prices. Live Lorcana pricing needs a data source/API, which can be added later.
