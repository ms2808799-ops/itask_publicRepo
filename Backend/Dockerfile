FROM node:18-alpine
WORKDIR /iTask_app
COPY package*.json ./
RUN npm ci --omit=dev 
COPY . .
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD [ "node","server.js" ]