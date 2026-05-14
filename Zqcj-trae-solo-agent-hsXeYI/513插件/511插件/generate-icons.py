#!/usr/bin/env python3
"""
MatchPulse Logo Generator
Generates PNG icons at sizes 16x16, 48x48, and 128x128
"""

from PIL import Image, ImageDraw, ImageColor
import math

def draw_soccer_pattern(draw, cx, cy, radius, size):
    """Draw a soccer ball pattern"""
    hex_radius = radius * 0.3
    
    # Draw center pentagon
    pentagon_points = []
    for i in range(5):
        angle = (i * 2 * math.pi / 5) - math.pi / 2
        x = cx + hex_radius * math.cos(angle)
        y = cy + hex_radius * math.sin(angle)
        pentagon_points.append((x, y))
    
    draw.polygon(pentagon_points, fill='#000000', outline='#000000', width=max(1, size // 64))
    
    # Draw other lines
    for i in range(5):
        angle = (i * 2 * math.pi / 5) - math.pi / 2
        start_x = cx + hex_radius * math.cos(angle)
        start_y = cy + hex_radius * math.sin(angle)
        end_x = cx + radius * 0.9 * math.cos(angle)
        end_y = cy + radius * 0.9 * math.sin(angle)
        
        draw.line([(start_x, start_y), (end_x, end_y)], fill='#000000', width=max(1, size // 64))

def draw_logo(size):
    """Draw the MatchPulse logo at specified size"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    center = size / 2
    radius = size / 2 - 2
    
    # 1. Draw outer border gradient
    border_img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    border_draw = ImageDraw.Draw(border_img)
    
    # Draw outer circle with gradient
    for i in range(int(radius * 0.8), int(radius) + 1):
        ratio = (i - radius * 0.8) / (radius * 0.2) if radius * 0.2 != 0 else 0
        # Interpolate between cyan colors
        r1, g1, b1 = 0, 212, 255
        r2, g2, b2 = 0, 128, 255
        r = int(r1 + (r2 - r1) * ratio)
        g = int(g1 + (g2 - g1) * ratio)
        b = int(b1 + (b2 - b1) * ratio)
        
        border_draw.ellipse([center - i, center - i, center + i, center + i], 
                          outline=(r, g, b, 255), width=2)
    
    # Fill the border
    draw.ellipse([center - radius, center - radius, center + radius, center + radius], 
               fill=(10, 14, 39, 255))
    
    # Overlay the border
    img = Image.alpha_composite(img, border_img)
    draw = ImageDraw.Draw(img)
    
    # 2. Draw deep blue background
    draw.ellipse([center - (radius - 2), center - (radius - 2), 
                 center + (radius - 2), center + (radius - 2)], 
                fill=(10, 14, 39, 255))
    
    # 3. Draw arc pulse wave
    wave_radius = radius * 0.7
    draw.arc([center - wave_radius, center - wave_radius, 
             center + wave_radius, center + wave_radius],
            start=-144, end=-36, fill=(0, 212, 255, 128), width=max(1, size // 32))
    
    # 4. Draw soccer ball
    soccer_radius = radius * 0.4
    
    # Soccer ball main circle
    draw.ellipse([center - soccer_radius, center - soccer_radius, 
                 center + soccer_radius, center + soccer_radius],
                fill=(255, 255, 255, 255), outline=(0, 0, 0, 255),
                width=max(1, size // 64))
    
    # Draw soccer pattern
    draw_soccer_pattern(draw, center, center, soccer_radius, size)
    
    # 5. Draw cyan pulse glow in top right
    pulse_x = center + radius * 0.5
    pulse_y = center - radius * 0.5
    
    # Glow effect (multiple layers for gradient)
    for i in range(max(1, size // 16), 0, -1):
        alpha = int(255 * (1 - i / (size // 16)))
        draw.ellipse([pulse_x - i, pulse_y - i, pulse_x + i, pulse_y + i],
                    fill=(0, 212, 255, max(0, alpha)))
    
    # Pulse core
    draw.ellipse([pulse_x - size // 32, pulse_y - size // 32, 
                 pulse_x + size // 32, pulse_y + size // 32],
                fill=(0, 212, 255, 255))
    
    # 6. Draw purple small signal in bottom left
    signal_x = center - radius * 0.4
    signal_y = center + radius * 0.4
    
    draw.ellipse([signal_x - size // 48, signal_y - size // 48, 
                 signal_x + size // 48, signal_y + size // 48],
                fill=(124, 77, 255, 255))
    
    return img

def main():
    sizes = [16, 48, 128]
    output_dir = 'dist_b488693/icons'
    
    import os
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    for size in sizes:
        img = draw_logo(size)
        filename = os.path.join(output_dir, f'icon{size}.png')
        img.save(filename, 'PNG')
        print(f'Generated {filename}')
    
    print('All logos generated successfully!')

if __name__ == '__main__':
    main()
