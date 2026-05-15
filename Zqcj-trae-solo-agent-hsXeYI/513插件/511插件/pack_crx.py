#!/usr/bin/env python3
import struct
import zipfile
import os
import subprocess
import tempfile

print('MatchPulse CRX 打包工具')
print('=' * 50)

extension_dir = 'dist_b488693'
pem_file = 'dist_b488693.pem'
crx_file = 'MatchPulse_v0.2.7_fixed.crx'
zip_file = 'temp_extension.zip'

# 步骤1: 清理旧文件
print('\n步骤1: 清理旧文件...')
if os.path.exists(crx_file):
    os.remove(crx_file)
    print(f'  删除: {crx_file}')
if os.path.exists(zip_file):
    os.remove(zip_file)
    print(f'  删除: {zip_file}')

# 步骤2: 创建 ZIP 文件
print('\n步骤2: 创建 ZIP 文件...')
os.system(f'zip -r {zip_file} {extension_dir} > /dev/null 2>&1')
print(f'  已创建: {zip_file}')

# 步骤3: 处理私钥
print('\n步骤3: 处理私钥...')
if not os.path.exists(pem_file):
    print(f'  错误: 找不到私钥文件 {pem_file}')
    exit(1)

# 读取私钥检查格式
with open(pem_file, 'rb') as f:
    pem_data = f.read()

if b'BEGIN PRIVATE KEY' in pem_data:
    # PKCS#8 格式 - 转换为 PKCS#1
    print('  检测到 PKCS#8 格式，转换为 PKCS#1...')
    subprocess.run('openssl rsa -in dist_b488693.pem -out temp_key.pem', 
                   shell=True, capture_output=True)
    key_file = 'temp_key.pem'
elif b'BEGIN RSA PRIVATE KEY' in pem_data:
    # PKCS#1 格式 - 直接使用
    print('  检测到 PKCS#1 格式')
    key_file = pem_file
    with open('temp_key.pem', 'wb') as f:
        f.write(pem_data)
    key_file = 'temp_key.pem'
else:
    print('  错误: 未知的私钥格式')
    exit(1)

# 步骤4: 创建签名
print('\n步骤4: 创建签名...')
subprocess.run(f'openssl dgst -sha256 -sign {key_file} -out temp_signature {zip_file}', 
               shell=True, capture_output=True)
print('  签名已创建')

# 步骤5: 提取公钥
print('\n步骤5: 提取公钥...')
subprocess.run('openssl rsa -in temp_key.pem -pubout -out temp_pub.pem', 
               shell=True, capture_output=True)
subprocess.run('openssl rsa -pubin -in temp_pub.pem -RSAPublicKey_out -outform DER -out temp_pub.der',
               shell=True, capture_output=True)
print('  公钥已提取')

# 步骤6: 构建 CRX 文件
print('\n步骤6: 构建 CRX 文件...')
with open('temp_signature', 'rb') as f:
    signature = f.read()
print(f'  签名长度: {len(signature)} 字节')

with open('temp_pub.der', 'rb') as f:
    pub_der = f.read()
print(f'  公钥长度: {len(pub_der)} 字节')

with open(zip_file, 'rb') as f:
    zip_data = f.read()
print(f'  ZIP 数据长度: {len(zip_data)} 字节')

# CRX v2 格式
crx_magic = b'Cr24'
crx_version = struct.pack('<I', 2)  # Little Endian
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

# 步骤7: 清理临时文件
print('\n步骤7: 清理临时文件...')
temp_files = ['temp_extension.zip', 'temp_key.pem', 'temp_pub.pem', 
              'temp_pub.der', 'temp_signature']
for tf in temp_files:
    if os.path.exists(tf):
        os.remove(tf)
        print(f'  删除: {tf}')

# 步骤8: 显示结果
print('\n' + '=' * 50)
print('打包完成!')
print('=' * 50)
if os.path.exists(crx_file):
    size = os.path.getsize(crx_file)
    print(f'\n输出文件: {crx_file}')
    print(f'文件大小: {size:,} 字节 ({size/1024/1024:.2f} MB)')
else:
    print('\n错误: CRX 文件创建失败')
    exit(1)
