"""Shared paths for the build tools. Run the tools from anywhere; set the two environment variables first.

SAVAGE_EXTRACT  folder holding files extracted from the game archives (models/, terrain/, foliage/, mines/ ...)
SAVAGE_MAPS     folder holding the map archives (<map>.s2z and <map>_overhead.jpg)
"""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # the repository root (the website)
DATA = os.path.join(ROOT, 'data')
BUILD = os.path.join(ROOT, 'build')                                   # intermediate files, not committed
EXTRACT = os.environ.get('SAVAGE_EXTRACT', os.path.join(ROOT, 'extract')).rstrip('/\\') + '/'
MAPS = os.environ.get('SAVAGE_MAPS', os.path.join(ROOT, 'maps'))
os.makedirs(BUILD, exist_ok=True)
