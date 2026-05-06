FROM node:22-alpine

WORKDIR /opt/healthchecker

COPY package.json ./
COPY healthchecker.js ./

ENTRYPOINT [ "node", "healthchecker.js" ]
