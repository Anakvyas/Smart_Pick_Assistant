from flask import Flask, jsonify

app = Flask(__name__)

@app.route("/")
def home():
    return jsonify({
        "message": "Smart Pick Assistant AI Service is running"
    })

if __name__ == "__main__":
    app.run(port=8000)
