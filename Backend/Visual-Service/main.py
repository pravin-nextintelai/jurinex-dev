"""
Visual Service - Main Application Entry Point
Flask application for generating flowcharts from documents using Gemini 1.5 Flash
"""
from flask import Flask, jsonify
from flask_cors import CORS
from datetime import datetime
import os
from dotenv import load_dotenv

load_dotenv()

from app.routes.visual_routes import visual_bp
from app.config.db import init_db_pool, close_db_pool

app = Flask(__name__)

try:
    init_db_pool()
    print("✅ Database connection pool initialized")
except Exception as e:
    print(f"⚠️ Warning: Database initialization failed: {str(e)}")
    print("⚠️ Mind map features will not be available without database connection")

import atexit
atexit.register(close_db_pool)

allowed_origins = [
    'http://localhost:5173',
    'https://jurinex.netlify.app',
    'https://microservicefrontend.netlify.app'
]
CORS(app, origins=allowed_origins)


app.register_blueprint(visual_bp, url_prefix='/api/visual')

# ── Central error capture (docs/error-logging.md). Vendored copy: ./errorlog ──
from errorlog import install as _install_errorlog  # noqa: E402

_install_errorlog(
    flask_app=app,
    service_name="visual-service",
    own_code_root=os.path.dirname(os.path.abspath(__file__)),
)


@app.route('/api/test-route', methods=['GET'])
def test_route():
    """
    Test route to verify service is running
    
    GET /api/test-route
    
    Returns: Simple success message
    """
    return jsonify({'message': '✅ Visual Service is working!'})


@app.route('/health', methods=['GET'])
def health_check():
    """
    Health check endpoint for monitoring and load balancers
    
    GET /health
    
    Returns: Service health status with timestamp
    """
    return jsonify({
        'status': 'healthy',
        'service': 'visual-service',
        'timestamp': datetime.utcnow().isoformat()
    }), 200


if __name__ == '__main__':
    """
    Application entry point
    
    Runs the Flask development server on the specified port.
    In production, use a WSGI server like Gunicorn.
    """
    port = int(os.getenv('PORT', 8081))
    
    debug_mode = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'
    
    app.run(host='0.0.0.0', port=port, debug=debug_mode)
