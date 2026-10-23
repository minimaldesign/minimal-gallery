<?php
require_once('mg_prefs.php');
// to pass img uri to mg_thumb.php
$thumbcat = $_GET['thumbcat'];
$thumb = $_GET['thumb'];
// variables
$img_uri = "../../$media_dir$thumbcat/$thumb";									// img location
$thumbs_dir = 'thumbs';															// cached thumbnails location

// Transversal attack sanitizing (thanks Str0ke!)
function check($var) {
	if(strstr($var, '..') == TRUE) {
		die("This security issue has been fixed... Thanks for checking!");
	}
	return $var;
}

$thumbcat = check($_GET['thumbcat']);
$thumb = check($_GET['thumb']);


if($byte = @filesize("../thumbs/$thumbcat$thumb")) {							// display cached thumbs if they exist
	header("content-length: $byte");
	readfile("../$thumbs_dir/$thumbcat$thumb");
} else {																		// create and display thumbs if they don't
$src = imagecreatefromjpeg($img_uri);
$width = imagesx($src);
$height = imagesy($src);

if ($thumbs_style == 'plain') {													// plain thumbnail maker
	$n_width = $thumb_size;
	$n_height = $thumb_size;
	if ($n_width && ($width<$height)) {											// get new dimensions depending on longest side 
	   $n_width = ($n_height/$height)*$width;
	} else {
	   $n_height = ($n_width/$width)*$height;
	}
	$dst = imagecreatetruecolor($n_width, $n_height);
	imagecopyresampled($dst, $src, 0, 0, 0, 0, $n_width, $n_height, $width, $height);
} else if($thumbs_style == 'artsy') {											// artsy thumbnail maker
	$n_width = $width*$scalling;
	$n_height = $height*$scalling;
	$dst = imagecreatetruecolor($thumb_size, $thumb_size);
	imagecopyresampled($dst, $src,-($n_width/2) +($thumb_size/2), -($n_height/2)+($thumb_size/2), 0, 0, $n_width , $n_height , $width, $height);
}

if (imagetypes() & IMG_JPG) {													// sends header back only if jpg is supported by GD lib on server
	header('Content-type: image/jpeg');
	}
imagejpeg($dst);																// send thumb to browser
imagejpeg($dst, "../$thumbs_dir/$thumbcat$thumb");								// cache thumb to disc
imagedestroy($dst);
}
?>