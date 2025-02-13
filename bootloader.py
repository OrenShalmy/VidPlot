import os
import sys
import threading
import webbrowser
from time import sleep

from app import app

def run_server():
	# Get the port from environment or use default
	port = int(os.environ.get('PORT', 5000))
	app.run(port=port)

def open_browser():
	# Wait for server to start
	sleep(1.5)
	webbrowser.open(f'http://localhost:5000/')

if __name__ == '__main__':
	if getattr(sys, 'frozen', False):
		# If we're running as a bundled exe, use the sys._MEIPASS path
		template_folder = os.path.join(sys._MEIPASS, 'templates')
		static_folder = os.path.join(sys._MEIPASS, 'static')
		app.template_folder = template_folder
		app.static_folder = static_folder

	# Start server in a separate thread
	server_thread = threading.Thread(target=run_server)
	server_thread.daemon = True
	server_thread.start()

	# Open browser in main thread
	open_browser()

	# Keep the main thread running
	try:
		while True:
			sleep(1)
	except KeyboardInterrupt:
		sys.exit(0)