FROM bfritscher/papersim-backend-base
COPY assets /app/assets
COPY public /app/public
COPY dist /app/dist
WORKDIR /app


EXPOSE 80
CMD ["supervisor", "--watch", "/app/dist", "dist/app.js"]
