"""Real TCP and TLS tests against the built receiver; no third-party dependencies."""
import base64, hashlib, http.client, os, pathlib, socket, ssl, struct, subprocess, tempfile, time, unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
BINARY=ROOT/'target/debug/ghostpad'
class Receiver(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.tmp=tempfile.TemporaryDirectory(); cls.env={**os.environ,'XDG_CONFIG_HOME':cls.tmp.name}
  try:cls.start()
  except PermissionError as e:
   cls.tmp.cleanup();raise unittest.SkipTest(f'Sandbox disallows TCP sockets: {e}')
 @classmethod
 def start(cls,extra=()):
  with socket.socket() as s:s.bind(('127.0.0.1',0));cls.port=s.getsockname()[1]
  cls.proc=subprocess.Popen([str(BINARY),'--preview','--address','127.0.0.1','--port',str(cls.port),*extra],env=cls.env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
  for _ in range(100):
   try:
    with socket.create_connection(('127.0.0.1',cls.port),.1):break
   except OSError:time.sleep(.03)
  else:raise RuntimeError(cls.proc.stderr.read().decode())
  cls.key=(pathlib.Path(cls.tmp.name)/'ghostpad/pairing-key').read_text()
 @classmethod
 def stop(cls):
  cls.proc.terminate();cls.proc.wait(timeout=3);cls.proc.stderr.close()
 @classmethod
 def tearDownClass(cls):cls.stop();cls.tmp.cleanup()
 def ws(self,key=None,origin=None,tls=False):
  s=socket.create_connection(('127.0.0.1',self.port),2);s.settimeout(7)
  if tls:s=ssl._create_unverified_context().wrap_socket(s,server_hostname='localhost')
  host=f'127.0.0.1:{self.port}';origin=origin or f'{"https" if tls else "http"}://{host}'
  s.sendall(f'GET /ws HTTP/1.1\r\nHost: {host}\r\nOrigin: {origin}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n'.encode())
  data=b''
  while not data.endswith(b'\r\n\r\n'):data+=s.recv(1)
  if origin.startswith('https://evil'):self.assertIn(b'403',data);s.close();return
  self.assertIn(b'101 Switching',data)
  self.send(s,1,(self.key if key is None else key).encode());return s
 def send(self,s,op,data):
  mask=b'abcd';s.sendall(bytes([0x80|op,0x80|len(data)])+mask+bytes(v^mask[i%4] for i,v in enumerate(data)))
 def recv(self,s):
  h=s.recv(2)
  if not h:return None
  data=b''
  while len(data)<h[1]:data+=s.recv(h[1]-len(data))
  return data
 def test_assets_and_headers(self):
  c=http.client.HTTPConnection('127.0.0.1',self.port);c.request('GET','/');r=c.getresponse();self.assertEqual(r.status,200);self.assertIn("frame-ancestors 'none'",r.getheader('Content-Security-Policy'));self.assertIn(b'Tap to start typing',r.read());c.close()
 def test_bad_host(self):
  c=http.client.HTTPConnection('127.0.0.1',self.port);c.request('GET','/',headers={'Host':'evil.example'});self.assertEqual(c.getresponse().status,403);c.close()
 def test_wrong_key(self):
  with self.ws('0'*64) as s:self.assertEqual(self.recv(s),b'unauthorized');self.assertIsNone(self.recv(s))
 def test_origin(self):self.ws(origin='https://evil.example')
 def test_controller_exclusion_and_recovery(self):
  with self.ws() as first:
   self.assertEqual(self.recv(first),b'ready:preview')
   with self.ws() as second:self.assertEqual(self.recv(second),b'busy')
   for packet in [b'\x01'+struct.pack('<ff',.25,-.5),b'\x02'+struct.pack('<ff',10,20),b'\x03',b'\x04',b'\x05',b'\x06',b'\x07',b'\x0f'+struct.pack('<f',1.375),b'\x10',b'\x08']:self.send(first,2,packet)
   self.assertEqual(self.recv(first),b'pong')
  time.sleep(.05)
  with self.ws() as s:self.assertEqual(self.recv(s),b'ready:preview')
 def test_invalid_input_closes_and_unlocks(self):
  with self.ws() as s:
   self.assertEqual(self.recv(s),b'ready:preview');self.send(s,2,b'\x05');self.send(s,2,b'\x01'+struct.pack('<ff',float('nan'),0));self.assertIsNone(self.recv(s))
  with self.ws() as s:self.assertEqual(self.recv(s),b'ready:preview')
 def test_timeout_unlocks(self):
  with self.ws() as s:
   self.assertEqual(self.recv(s),b'ready:preview');self.send(s,2,b'\x05');self.assertIsNone(self.recv(s))
  with self.ws() as s:self.assertEqual(self.recv(s),b'ready:preview')
 def test_z_persistence_rotation_tls(self):
  old=self.key;self.stop();self.start();self.assertEqual(self.key,old);self.stop();self.start(['--rotate-key']);self.assertNotEqual(self.key,old)
  cert=str(pathlib.Path(self.tmp.name)/'cert.pem');key=str(pathlib.Path(self.tmp.name)/'key.pem')
  subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  self.stop();self.start(['--cert',cert,'--key',key])
  with self.ws(tls=True) as s:self.assertEqual(self.recv(s),b'ready:preview');self.send(s,2,b'\x08');self.assertEqual(self.recv(s),b'pong')
if __name__=='__main__':unittest.main(verbosity=2)
