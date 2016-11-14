FROM node:6
RUN mkdir -p /app
RUN npm install -g supervisor phantomjs
COPY assets /app/assets
COPY public /app/public
COPY dist /app/dist
WORKDIR /app
COPY package.json /app/package.json
RUN npm install
EXPOSE 80
CMD ["supervisor", "--watch", "/app/dist", "dist/app.js"]
