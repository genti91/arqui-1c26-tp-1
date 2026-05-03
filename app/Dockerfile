FROM node:22
RUN mkdir /opt/app
WORKDIR /opt/app
COPY * ./
COPY seed ./seed
RUN npm install
ENTRYPOINT [ "node", "app.js" ]