# Node 22+ required (built-in node:sqlite)
# e.g. docker build -t trans . && docker run --env-file .env -p 8080:80 trans
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public

ENV NODE_ENV=production
EXPOSE 80

# npm start runs prestart (clean-uploads) then the server
CMD ["npm", "start"]
