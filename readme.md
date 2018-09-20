1. install nodejs
2. `npm install` in the project folder
3. `npm run build`to compile TypeScript
4. `npm run serve` or `node dist\app.js` to run server

.env
SENTRY_DSN
SENTRY_ENVIRONMENT
SESSION_SECRET
JWT_SECRET
ADMINS
HOST_URL

# prod
   docker build --tag bfritscher/papersim-backend .
   docker push bfritscher/papersim-backend