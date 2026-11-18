"""Real TCP and TLS tests against the built receiver; no third-party dependencies."""
import base64, hashlib, http.client, os, pathlib, socket, ssl, struct, subprocess, tempfile, time, unittest
import json
import shutil
import sys
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
 def ws(self,key=None,origin=None,tls=False,flow=False,session=False):
  s=socket.create_connection(('127.0.0.1',self.port),2);s.settimeout(7)
  if tls:s=ssl._create_unverified_context().wrap_socket(s,server_hostname='localhost')
  host=f'127.0.0.1:{self.port}';origin=origin or f'{"https" if tls else "http"}://{host}'
  protocol='Sec-WebSocket-Protocol: ghostpad.session.v1, ghostpad.flow.v1\r\n' if session else 'Sec-WebSocket-Protocol: ghostpad.flow.v1\r\n' if flow else ''
  s.sendall(f'GET /ws HTTP/1.1\r\nHost: {host}\r\nOrigin: {origin}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\n{protocol}Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n'.encode())
  data=b''
  while not data.endswith(b'\r\n\r\n'):data+=s.recv(1)
  if origin.startswith('https://evil'):self.assertIn(b'403',data);s.close();return
  self.assertIn(b'101 Switching',data)
  if session:self.assertIn(b'Sec-WebSocket-Protocol: ghostpad.session.v1\r\n',data)
  elif flow:self.assertIn(b'Sec-WebSocket-Protocol: ghostpad.flow.v1\r\n',data)
  self.send(s,1,(self.key if key is None else key).encode());return s
 def send(self,s,op,data):
  mask=b'abcd';s.sendall(bytes([0x80|op,0x80|len(data)])+mask+bytes(v^mask[i%4] for i,v in enumerate(data)))
 def recv(self,s):
  def exact(n):
   data=b''
   while len(data)<n:
    chunk=s.recv(n-len(data))
    if not chunk:
     if not data:return None
     raise EOFError('Partial WebSocket frame')
    data+=chunk
   return data
  h=exact(2)
  return exact(h[1]) if h else None
 def check_flow(self,tls=False):
  with self.ws(flow=True,tls=tls) as s:
   self.assertEqual(self.recv(s),b'ready:preview')
   packets=[b'\x09\xe3',b'\x05',b'\x01'+struct.pack('<ff',1.25,-2.5),b'\x06',b'\x0a\xe3',b'\x0e'+b'a'*120,b'\x0f'+struct.pack('<f',1.2),b'\x10',b'\x07']
   # Deliberately batch arrivals and delay consuming replies, as on a jittery link.
   for seq,packet in enumerate(packets,1):self.send(s,2,b'\x11'+struct.pack('<H',seq)+packet)
   time.sleep(.08)
   for seq in range(1,len(packets)+1):self.assertEqual(self.recv(s),b'\x11'+struct.pack('<H',seq))
   self.send(s,2,b'\x11'+struct.pack('<H',len(packets)+1)+b'\x08');self.assertEqual(self.recv(s),b'pong');self.assertEqual(self.recv(s),b'\x11'+struct.pack('<H',len(packets)+1))
   # A duplicate must close and release the authenticated controller.
   self.send(s,2,b'\x11'+struct.pack('<H',len(packets)+1)+b'\x05');self.assertIsNone(self.recv(s))
  with self.ws(flow=True,tls=tls) as s:self.assertEqual(self.recv(s),b'ready:preview')
 def test_acknowledged_input(self):self.check_flow()
 def check_handoff(self,tls=False):
  a,b='a'*32,'b'*32
  def connect(tab,mode,key=self.key):
   peer=self.ws(f'{key}:{tab}{mode}',tls=tls,session=True)
   peer.settimeout(1)
   return peer
  with connect(a,'n') as first:
   self.assertEqual(self.recv(first),b'ready:preview')
   with connect(b,'n') as other:
    self.assertEqual(self.recv(other),b'busy')
   with connect(b,'t','0'*64) as unauthorized:
    self.assertEqual(self.recv(unauthorized),b'unauthorized')
   self.send(first,2,b'\x11\x01\x00\x05')
   self.assertEqual(self.recv(first),b'\x11\x01\x00')
   with connect(a,'r') as resumed:
    self.assertEqual(self.recv(resumed),b'ready:preview')
    self.assertIsNone(self.recv(first))
    self.send(resumed,2,b'\x11\x01\x00\x09\xe3')
    self.assertEqual(self.recv(resumed),b'\x11\x01\x00')
    with connect(b,'t') as other:
     self.assertEqual(self.recv(other),b'ready:preview')
     self.assertIsNone(self.recv(resumed))
     with connect(a,'r') as displaced:
      self.assertEqual(self.recv(displaced),b'busy')
     self.send(other,2,b'\x11\x01\x00\x08')
     self.assertEqual(self.recv(other),b'pong')
     self.assertEqual(self.recv(other),b'\x11\x01\x00')
     self.send(other,8,b'')
     self.assertEqual(self.recv(other),b'')
  with connect(a,'r') as displaced:
   self.assertEqual(self.recv(displaced),b'busy')
  with connect(b,'r') as current:
   self.assertEqual(self.recv(current),b'ready:preview')
 def test_same_tab_recovery_and_deliberate_handoff(self):self.check_handoff()
 def test_assets_and_headers(self):
  c=http.client.HTTPConnection('127.0.0.1',self.port);c.request('GET','/');r=c.getresponse();self.assertEqual(r.status,200);self.assertIn("frame-ancestors 'none'",r.getheader('Content-Security-Policy'));self.assertIn(b'Tap to start typing',r.read());c.close()
 def test_bad_host(self):
  c=http.client.HTTPConnection('127.0.0.1',self.port);c.request('GET','/',headers={'Host':'evil.example'});self.assertEqual(c.getresponse().status,403);c.close()
 def test_repeat_launch(self):
  command=[str(BINARY),'--address','127.0.0.1','--port',str(self.port)]
  result=subprocess.run(command,env=self.env,input=b'\n',capture_output=True,timeout=5)
  self.assertEqual(result.returncode,0,result.stderr.decode())
  self.assertIn(b'Ghostpad is already running',result.stdout)
  self.assertIn(f'/#key={self.key}'.encode(),result.stdout)
  for option in ['--rotate-key','--preview','--keyboard-debug']:
   blocked=subprocess.run([*command,option],env=self.env,input=b'\n',capture_output=True,timeout=5)
   self.assertNotEqual(blocked.returncode,0)
  self.assertEqual((pathlib.Path(self.tmp.name)/'ghostpad/pairing-key').read_text(),self.key)
  with self.ws() as s:self.assertEqual(self.recv(s),b'ready:preview')
 def test_unrelated_listener_is_not_reused(self):
  with socket.socket() as listener:
   listener.bind(('127.0.0.1',0));listener.listen()
   result=subprocess.run([str(BINARY),'--address','127.0.0.1','--port',str(listener.getsockname()[1])],env=self.env,input=b'\n',capture_output=True,timeout=5)
   self.assertNotEqual(result.returncode,0)
   self.assertIn(b'already in use',result.stderr)
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
  self.check_flow(tls=True)
  self.check_handoff(tls=True)
  with self.ws(tls=True) as s:self.assertEqual(self.recv(s),b'ready:preview');self.send(s,2,b'\x08');self.assertEqual(self.recv(s),b'pong')


class NetworkChanges(unittest.TestCase):
    def test_pairing_follows_lan_address_changes(self):
        if not os.environ.get('GHOSTPAD_TEST_NETWORK_NAMESPACE'):
            unshare = shutil.which('unshare')
            if not unshare or not shutil.which('ip'):
                self.skipTest('The isolated network test requires unshare and ip')
            namespace = [unshare, '--user', '--map-root-user', '--net']
            probe = subprocess.run([*namespace, 'true'], capture_output=True)
            if probe.returncode:
                self.skipTest('The test environment does not allow unprivileged network namespaces')
            result = subprocess.run(
                [*namespace, sys.executable, __file__, 'NetworkChanges.test_pairing_follows_lan_address_changes'],
                env={**os.environ, 'GHOSTPAD_TEST_NETWORK_NAMESPACE': '1'}, capture_output=True,
                text=True, timeout=15,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            return

        def ip(*args):
            subprocess.run(['ip', *args], check=True, capture_output=True)

        def request(address, path, method='GET', headers=None):
            connection = http.client.HTTPConnection(address, port, timeout=.5)
            try:
                connection.request(method, path, headers=headers or {})
                response = connection.getresponse()
                return response.status, response.read()
            finally:
                connection.close()

        def await_lan(expected):
            for _ in range(100):
                try:
                    status, body = request('127.0.0.1', '/api/desktop/status', headers=auth)
                    if status == 200 and json.loads(body)['lanOrigin'] == expected:
                        return json.loads(body)
                except OSError:
                    pass
                time.sleep(.03)
            self.fail(f'The desktop page never advertised {expected!r}')

        ip('link', 'set', 'lo', 'up')
        ip('link', 'add', 'ethghost', 'type', 'veth', 'peer', 'name', 'ethpeer')
        ip('link', 'set', 'ethghost', 'up')
        ip('link', 'set', 'ethpeer', 'up')
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
        with tempfile.TemporaryDirectory() as directory, subprocess.Popen(
            [str(BINARY), '--preview', '--port', str(port), '--hostname', 'ghostpad-test.local', '--no-pairing-output'],
            env={**os.environ, 'XDG_CONFIG_HOME': directory}, stdout=subprocess.DEVNULL,
        ) as receiver:
            try:
                key = pathlib.Path(directory) / 'ghostpad/pairing-key'
                for _ in range(100):
                    if key.exists() and key.stat().st_size == 64:
                        break
                    time.sleep(.03)
                auth = {'Authorization': f'Bearer {key.read_text()}'}
                self.assertIsNone(await_lan(None)['pairingOrigin'])
                ip('addr', 'add', '192.168.250.1/24', 'dev', 'ethghost')
                first = f'http://192.168.250.1:{port}'
                stable = f'http://ghostpad-test.local:{port}'
                self.assertEqual(await_lan(first)['pairingOrigin'], stable)
                self.assertEqual(request('192.168.250.1', '/health'), (200, b'ghostpad/1'))
                self.assertEqual(request('192.168.250.1', '/health', headers={'Host': f'ghostpad-test.local:{port}'}),
                                 (200, b'ghostpad/1'))
                self.assertEqual(request('127.0.0.1', '/health', headers={'Host': f'ghostpad-test.local:{port}'})[0], 403)
                ip('addr', 'del', '192.168.250.1/24', 'dev', 'ethghost')
                await_lan(None)
                ip('addr', 'add', '192.168.250.2/24', 'dev', 'ethghost')
                self.assertEqual(await_lan(f'http://192.168.250.2:{port}')['pairingOrigin'], stable)
                self.assertEqual(request('192.168.250.2', '/health'), (200, b'ghostpad/1'))
                self.assertEqual(request('127.0.0.1', '/api/desktop/qr/ip', headers={
                    **auth, 'X-Ghostpad-Pairing-Origin': first,
                })[0], 409)
                self.assertEqual(request('127.0.0.1', '/api/desktop/stop', 'POST', headers={
                    **auth, 'Origin': f'http://127.0.0.1:{port}',
                })[0], 200)
                self.assertEqual(receiver.wait(timeout=2), 0)
            finally:
                if receiver.poll() is None:
                    receiver.terminate()
            saved_key = key.read_text()
            with subprocess.Popen(
                [str(BINARY), '--preview', '--address', '192.168.250.2', '--port', str(port), '--no-pairing-output'],
                env={**os.environ, 'XDG_CONFIG_HOME': directory}, stdout=subprocess.DEVNULL,
            ) as pinned:
                try:
                    for _ in range(100):
                        try:
                            if request('192.168.250.2', '/health') == (200, b'ghostpad/1'):
                                break
                        except OSError:
                            pass
                        time.sleep(.03)
                    else:
                        self.fail('The pinned receiver did not start')
                    blocked = subprocess.run(
                        [str(BINARY), '--preview', '--port', str(port), '--rotate-key'],
                        env={**os.environ, 'XDG_CONFIG_HOME': directory}, capture_output=True, timeout=2,
                    )
                    self.assertNotEqual(blocked.returncode, 0)
                    self.assertIn(b'already in use', blocked.stderr)
                    self.assertEqual(key.read_text(), saved_key)
                finally:
                    pinned.terminate()


if __name__=='__main__':unittest.main(verbosity=2)
