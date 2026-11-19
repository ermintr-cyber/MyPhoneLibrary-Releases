import socket,tempfile,threading,time,unittest
from unittest.mock import patch
import server

class IdleShutdownTests(unittest.TestCase):
    def test_preconnected_socket_cannot_hold_shutdown(self):
        self.assertGreater(server.Handler.timeout,0)
        self.assertLessEqual(server.Handler.timeout,5)
        with tempfile.TemporaryDirectory() as folder, patch.object(server.Handler,'timeout',.2):
            http=server.AppServer(('127.0.0.1',0),server.Store(folder))
            serving=threading.Thread(target=http.serve_forever);serving.start()
            peer=socket.create_connection(http.server_address)
            finished=threading.Event()
            try:
                time.sleep(.05);http.shutdown();serving.join()
                def close():http.server_close();finished.set()
                closer=threading.Thread(target=close);closer.start()
                self.assertTrue(finished.wait(2),'Idle connection prevented server shutdown')
                self.assertEqual(peer.recv(1),b'')
            finally:
                peer.close();http.shutdown();http.server_close();serving.join()
