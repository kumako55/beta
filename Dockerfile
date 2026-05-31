FROM node:20-bullseye

# Python + Flask
RUN apt-get update && apt-get install -y python3 python3-pip
RUN pip3 install flask

WORKDIR /app

# Node deps
COPY package.json ./
RUN npm install

# Python deps
COPY requirements.txt ./
RUN pip3 install -r requirements.txt

# Code
COPY server.js app.py ./

# HF port
EXPOSE 7860
ENV PORT=7860
ENV PHONE=92XXXXXXXXXX

# Persistent auth
RUN mkdir -p /data/auth

CMD bash -c "python3 app.py & node server.js"
