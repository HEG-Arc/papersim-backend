FROM node:6
RUN npm install -g supervisor phantomjs
RUN mkdir -p /app
WORKDIR /app
COPY package.json /app/package.json
RUN npm install

