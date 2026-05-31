import urllib.request, json, base64
from pyDes import des, ECB
d = des(b'38346591', ECB, padmode=2)
r = urllib.request.urlopen('https://www.jiosaavn.com/api.php?__call=song.getDetails&cc=in&_bit_rate=320&_format=json&pids=1e0En7YX&ctx=android')
data = json.loads(r.read())
enc = data['1e0En7YX']['encrypted_media_url']
dec = d.decrypt(base64.b64decode(enc)).decode('utf-8')
url = dec.replace('.mp4', '_320.mp4')
print(url)
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
print('Status:', urllib.request.urlopen(req).status)
