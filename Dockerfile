FROM node:20-bullseye

WORKDIR /app

# Node dependencies
COPY package.json ./
RUN npm install --production

# Code copy
COPY server.js ./

# Render ka port (Render khud PORT deta hai, hum 10000 default rakhenge)
EXPOSE 10000
ENV PORT=10000
ENV PHONE=92XXXXXXXXXX

# Baileys auth ke liye persistent folder
RUN mkdir -p /data/auth
VOLUME ["/data/auth"]

# Sirf Node chalao
CMD ["node", "server.js"]
