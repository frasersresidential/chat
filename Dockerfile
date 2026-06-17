# OmniChat — production container
FROM node:20-alpine

WORKDIR /app

# Install dependencies first for better layer caching
COPY package*.json ./
RUN npm install --omit=dev

# App source
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

# data/ holds the JSON store + uploads. Mount a volume here to persist them.
VOLUME ["/app/data"]

CMD ["npm", "start"]
