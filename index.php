<?php
// DON'T REMOVE THIS
require_once('./_mg/php/mg_brain.php');
// needs to stay at the top because it sends a header
slideshow();
?>

<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN"
        "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
<head>
<title><?= $mg_name ?> &raquo; <? current_file_cat(); ?> &raquo; <? my_iptc('title'); ?></title>
<meta http-equiv="content-type" content="text/html; charset=utf-8" />
<meta name="generator" content="minimalGallery <?= $mg_version ?>" /> <!-- leave this for stats -->
<style type="text/css" media="screen">
		@import url( ./_mg/templates/<?= $current_theme ?>/mg.css );
</style>
<script src="_mg/js/jquery.js" type="text/javascript" charset="utf-8"></script>
<script src="_mg/templates/<?= $current_theme ?>/mg.js" type="text/javascript" charset="utf-8"></script>
</head>
<body>
<div id="content">
	<? @include("./_mg/templates/$current_theme/view_$current_view.php"); ?>
</div>
</body>
</html>