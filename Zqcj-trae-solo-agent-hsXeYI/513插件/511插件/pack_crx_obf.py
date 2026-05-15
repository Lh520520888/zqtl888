#!/usr/bin/env python3
import struct
import zipfile
import os
import subprocess

print('MatchPulse CRX 打包工具 (混淆版本)')
print('=' * 50)

extension_dir = 'dist_b488693_obfuscated'
pem_file = 'dist_b488693.pem'
crx_file = 'MatchPulse_v0.2.7_fixed_obfuscated.crx'
zip_file = 'temp_extension_obf.zip'

print('\n步骤1: 清理旧文件...')
if os.path.exists(crx_file):
    os.remove(crx_file)
if os.path.exists(zip_file):
    os.remove(zip_file)

print('步骤2: 创建 ZIP 文件...')
os.system(f'zip -r {zip_file} {extension_dir} > /dev/null 2>&1')

print('步骤3: 处理私钥...')
with open(pem_file, 'rb') as f:
    pem_data = f.read()

if b'BEGIN PRIVATE KEY' in pem_data:
    subprocess.run('openssl rsa -in dist_b488693.pem -out temp_key.pem', 
                   shell=True, capture_output=True)
elif b'BEGIN RSA PRIVATE KEY' in pem_data:
    with open('temp_key.pem', 'wb') as f:
        f.write(pem_data)

print('步骤4: 创建签名...')
subprocess.run(f'openssl dgst -sha256 -sign temp_key.pem -out temp_signature {zip_file}', 
               shell=True, capture_output=True)

print('步骤5: 提取公钥...')
subprocess.run('openssl rsa -in temp_key.pem -pubout -out temp_pub.pem', 
               shell=True, capture_output=True)
subprocess.run('openssl rsa -pubin -in temp_pub.pem -RSAPublicKey_out -outform DER -out temp_pub.der',
               shell=True, capture_output=True)

print('步骤6: 构建 CRX 文件...')
with open('temp_signature', 'rb') as f:
    signature = f.read()
with open('temp_pub.der', 'rb') as f:
    pub_der = f.read()
with open(zip_file, 'rb') as f:
    zip_data = f.read()

crx_magic = b'Cr24'
crx_version = struct.pack('<I', 2)
pub_len = struct.pack('<I', len(pub_der))
sig_len = struct.pack('<I', len(signature))

with open(crx_file, 'wb') as f:
    f.write(crx_magic)
    f.write(crx_version)
    f.write(pub_len)
    f.write(pub_der)
    f.write(sig_len)
    f.write(signature)
    f.write(zip_data)

print(f'  CRX 文件已创建: {crx_file}')

print('\n步骤7: 清理临时文件...')
temp_files = [zip_file, 'temp_key.pem', 'temp_pub.pem', 'temp_pub.der', 'temp_signature']
for tf in temp_files:
    if os.path.exists(tf):
        os.remove(tf)

print('\n' + '=' * 50)
if os.path.exists(crx_file):
    size = os.path.getsize(crx_file)
    print(f'打包完成!')
    print(f'输出文件: {crx_file}')
    print(f'文件大小: {size:,} 字节 ({size/1024/1024:.2f} MB)')
