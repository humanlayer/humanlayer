#!/usr/bin/env python3
import sys
from PIL import Image
import numpy as np

def rgb_to_hsv(rgb):
    """Convert RGB to HSV using numpy for speed"""
    rgb = rgb.astype('float32') / 255.0
    maxc = np.max(rgb, axis=2)
    minc = np.min(rgb, axis=2)
    v = maxc
    
    deltac = maxc - minc
    s = np.where(maxc != 0, deltac / maxc, 0)
    
    # Hue calculation
    rc = np.where(deltac != 0, (maxc - rgb[:,:,0]) / deltac, 0)
    gc = np.where(deltac != 0, (maxc - rgb[:,:,1]) / deltac, 0)
    bc = np.where(deltac != 0, (maxc - rgb[:,:,2]) / deltac, 0)
    
    h = np.zeros_like(maxc)
    h = np.where((rgb[:,:,0] == maxc) & (deltac != 0), bc - gc, h)
    h = np.where((rgb[:,:,1] == maxc) & (deltac != 0), 2.0 + rc - bc, h)
    h = np.where((rgb[:,:,2] == maxc) & (deltac != 0), 4.0 + gc - rc, h)
    h = (h / 6.0) % 1.0
    
    return np.stack([h, s, v], axis=2)

def hsv_to_rgb(hsv):
    """Convert HSV back to RGB"""
    h, s, v = hsv[:,:,0], hsv[:,:,1], hsv[:,:,2]
    
    i = np.floor(h * 6.0).astype(int)
    f = h * 6.0 - i
    p = v * (1.0 - s)
    q = v * (1.0 - f * s)
    t = v * (1.0 - (1.0 - f) * s)
    
    i = i % 6
    
    rgb = np.zeros_like(hsv)
    idx = (i == 0)
    rgb[idx] = np.stack([v[idx], t[idx], p[idx]], axis=1)
    idx = (i == 1)
    rgb[idx] = np.stack([q[idx], v[idx], p[idx]], axis=1)
    idx = (i == 2)
    rgb[idx] = np.stack([p[idx], v[idx], t[idx]], axis=1)
    idx = (i == 3)
    rgb[idx] = np.stack([p[idx], q[idx], v[idx]], axis=1)
    idx = (i == 4)
    rgb[idx] = np.stack([t[idx], p[idx], v[idx]], axis=1)
    idx = (i == 5)
    rgb[idx] = np.stack([v[idx], p[idx], q[idx]], axis=1)
    
    return (rgb * 255).astype('uint8')

def rotate_hue(image_path, output_path, hue_shift=0.3):
    """Rotate hue of an image by specified amount (0.3 = 108 degrees)"""
    img = Image.open(image_path).convert('RGBA')
    rgb = np.array(img)
    
    # Separate alpha channel
    alpha = rgb[:,:,3]
    rgb_only = rgb[:,:,:3]
    
    # Convert to HSV, rotate hue, convert back
    hsv = rgb_to_hsv(rgb_only)
    hsv[:,:,0] = (hsv[:,:,0] + hue_shift) % 1.0
    rgb_rotated = hsv_to_rgb(hsv)
    
    # Recombine with alpha
    result = np.dstack([rgb_rotated, alpha])
    
    Image.fromarray(result, 'RGBA').save(output_path)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python rotate_icon_colors.py input.png output.png")
        sys.exit(1)
    
    rotate_hue(sys.argv[1], sys.argv[2], hue_shift=0.3)