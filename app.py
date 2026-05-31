from flask import Flask, jsonify
import os

app = Flask(__name__)

@app.route("/")
def home():
    return jsonify({
        "status": "running",
        "bot": "WhatsApp Meta AI",
        "phone": os.getenv("PHONE", "not set")
    })

@app.route("/health")
def health():
    return "OK"

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=7860)
