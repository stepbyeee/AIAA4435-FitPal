"""Fetch pinned offline benchmark assets. No TensorFlow packages enter the app."""
import hashlib
import io
from pathlib import Path
import subprocess
import tarfile

out = Path(__file__).resolve().parents[1] / '.benchmark-assets' / 'movenet'
out.mkdir(parents=True, exist_ok=True)
sources = [
    ('https://www.kaggle.com/api/v1/models/google/movenet/tfJs/singlepose-lightning/4/download',
     '28b9a96dde847d2c5dd0d44ddd131d6dfd388b8a014a4535dc31b4059ce61765',
     ['model.json', 'group1-shard1of2.bin', 'group1-shard2of2.bin']),
    ('https://registry.npmjs.org/@tensorflow/tfjs/-/tfjs-4.22.0.tgz',
     '56505c191e24116787477b3bb5bb1cc0cf1c2bdce8112b9c402a8a2d31cf2f00',
     ['package/dist/tf.min.js']),
    ('https://registry.npmjs.org/@tensorflow/tfjs-backend-wasm/-/tfjs-backend-wasm-4.22.0.tgz',
     '5cd6f5e18657c12fb94f4ec3dcef485c8c1a9ca39f3ef1d261c1cb13c1a231c3',
     ['package/dist/tf-backend-wasm.min.js', 'package/dist/tfjs-backend-wasm.wasm',
      'package/dist/tfjs-backend-wasm-simd.wasm', 'package/dist/tfjs-backend-wasm-threaded-simd.wasm']),
    ('https://registry.npmjs.org/@tensorflow-models/pose-detection/-/pose-detection-2.1.3.tgz',
     'a6930cc91808f384b7fad76180f5614b8070d8e2c75220abdd98b9229d6973b1',
     ['package/dist/pose-detection.min.js']),
]
for url, expected_hash, members in sources:
    archive = subprocess.check_output(['curl', '-fsSL', '--retry', '2', '--max-time', '120', url])
    if hashlib.sha256(archive).hexdigest() != expected_hash:
        raise ValueError(f'Unverified archive from {url}')
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as package:
        for member in members:
            (out / Path(member).name).write_bytes(package.extractfile(member).read())
print(out)
