	<h1><?php gallery_name('link') ?> :: last update <?php last_update_date('m.d.y') ?> :: <?php last_update_time() ?></h1>
	<div id="styles">
		<ul>
		    <li>styles:</li><?php style_switcher(); ?>
		</ul>
	</div>
	<div id="nav">
		<ul>
			<li>nav:</li><li><? nav_prev('prev'); ?></li><li><? nav_next(); ?></li><li>/</li><li><? nav_first(); ?></li><li><? nav_last(); ?></li><li>/</li><li><? randomizer('rand'); ?></li><li><? slideshow_switch('slides',' off '); ?></li>
		    <li>view:</li><?php view_switcher('list', 'thumbs', 'file'); ?>
		</ul>
	</div>
	<div id="cats">
        <ul>
		    <?php categories(); ?>
	    </ul>
	</div>
	<div id="file" class="view">
		<?php current_file(); ?>	
	</div>
	<div id="file_info">
    	<div id="file_count">
    		<?php current_file_count('&ndash;'); ?>
    	</div>
		<span id="file_title"><? my_iptc('title'); ?></span> :: <? current_file_size('KB','MB'); ?> uploaded on <? current_file_date('m.d.y'); ?> at <? current_file_time(); ?> in category <?php current_file_cat('link'); ?> :: <? extended_info_switch('EXIF off','EXIF'); ?>
	</div>
    <div id="shot_location">
	    <? my_iptc('location', '', ', '); ?><? my_iptc('city', ''); ?>
	</div>
    <div id="comment">
		<p><? my_iptc('caption', ''); ?></p>	
	</div>
	<div id="exif">
		<? current_file_info_extended(); ?>
	</div>
	<div id="footer">
		<?php mg_powered(); ?> &mdash; <?php validation(); ?>
	</div>
	<div id="photoblogs">
		<?php photoblogs(); ?>
	</div>