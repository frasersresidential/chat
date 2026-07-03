# Ad Spy — production container
FROM node:20-alpine

WORKDIR /app

# Install dependencies first for better layer caching
COPY package*.json ./
RUN npm install --omit=dev

# App source
COPY . .

ENV NODE_ENV=production
EXPOSE 4000

# data/ holds the JSON store. Mount a volume here to persist it.
VOLUME ["/app/data"]

CMD ["npm", "start"]
