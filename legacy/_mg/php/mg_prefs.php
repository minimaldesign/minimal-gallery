<?php


$mg_name = 'minimal Gallery';	// name of your gallery, will display in the body of some templates and the html <title> of all of them

$server_time = 0;				// server timezone adjustment (positive or negative integer)

$theme = 'multi';				// select one available style ('basic' 'dark' 'frame') or 'multi' to unable style switcher

$media_dir = './';				// relative path from index.php to media folder W/ TRAILING SLASH

$extended_info = 'no';			// displays some exif info by default - values 'yes' 'no'

$default_sorting= 'chrono';		// default file sorting setting (overridden by list view sorting options) - 'chrono' 'rchrono' 'alpha' 'ralpha'
$default_img = 'last';			// which file is shown by default in file view - 'first' 'last' 

// view 
$default_view = 'file';			// default view when gallery first loads - 'file' 'thumb' 'list'

// thumbnails
$thumbs_style = 'artsy';		// style of thumbnails 'artsy' or 'plain'
$thumb_size = 100;				// max width or height of thumb in pixels
$scalling = 0.3;				// thumbnail scalling down (for "artsy" thumbnails only)

// slideshow
$slides_speed = '4';			// slide show speed in seconds
$slide_type ='forward';			// slide whow behaviour - 'forward' 'backward' 'random'
$slide_scope ='local';			// slide show scope - goes through all files or or currently filtered files (i.e current category, etc...) - 'global' 'local'


?>