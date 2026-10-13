# MyVoteMatters: shuru kaise karein

Is folder mein poora project hai: website, admin console, voter app, database setup, tests aur screenshots.

## Vercel par live karna

1. Ye poora folder (jisme `package.json` hai) GitHub repo mein upload karo,
   ya pehle se bana repo use karo: https://github.com/sauravdwivedi108-web/MyVoteMatter
2. https://vercel.com/new kholo, GitHub se login karo, repo ke saamne **Import** → **Deploy**.
3. Project mein **Storage** → **Create Database** → **Neon** → region Mumbai/Singapore → **Connect** (saare environments tick).
4. **Deployments** → latest par **⋯** → **Redeploy**.
5. Site kholo → **Start free** → workspace banao.

## Pehla election

1. **Team** mein ek approver add karo (approve hamesha doosra vyakti karta hai).
2. **New election** → voter list paste karo (`folio, shares`) → resolutions likho → **Submit**.
3. Approver login karke **Approve** kare aur **tally key file download** kare. Ye sirf ek baar dikhti hai. Iske bina votes gine nahi ja sakte.
4. **Create voting links** → CSV download karke har voter ko uska link bhejo → **Open voting**.
5. Voting ke baad **Close voting** → key file upload karke **Count** → **Publish**.

## Folder mein kya hai

| Folder | Kya hai |
| --- | --- |
| `app/` | Saare pages: website, admin, voter app, results |
| `components/` | Buttons, forms, ballot builder, results |
| `lib/core/` | Voting engine: encryption, vote cast, counting |
| `db/` | Database tables, security rules |
| `test/` | 14 automatic tests |
| `screenshots/` | App kaisa dikhta hai |
| `README.md` | Technical details (English) |

## Dhyan rakhein

Ye pilot ke liye taiyaar hai. Asli shareholder voting se pehle: admin ke liye 2-step login, email se links bhejna, aur STQC certification baaki hai.
