	<div id="cats">
        <ul>
		    <?php categories(); ?>
	    </ul>
	</div>
	<h1><?php gallery_name('link') ?> | last update <?php last_update_date('m.d.y') ?> | <?php last_update_time() ?></h1>
	<div id="nav">
		<ul>
			<li><? nav_prev('prev'); ?></li><li><? nav_next(); ?></li><li>|</li><li><? nav_first(); ?></li><li><? nav_last(); ?></li><li>|</li><li><? randomizer('rand'); ?></li><li><? slideshow_switch('slides','&ndash; off &ndash;'); ?></li><li>|</li><?php view_switcher('list', 'thumbs', 'file'); ?>
		</ul>
	</div>
	<div id="file_title">
	    <span><? my_iptc('title'); ?></span> &mdash; <? my_iptc('location', '', ', '); ?><? my_iptc('city', ''); ?>
	</div>
	<div id="file" class="view">
        <div>
    		<?php current_file(); ?>
        </div>
	</div>
	<div id="file_info"> 
        <?php current_file_count(' of '); ?> | size: <? current_file_size('KB','MB'); ?> | upload: <? current_file_date('m.d.y'); ?> @ <? current_file_time(); ?> | cat: <?php current_file_cat('link'); ?> | <? extended_info_switch('less','more'); ?>
	</div>
	<div id="exif">
		<? current_file_info_extended(); ?>
	</div>
    <div id="comment">
		<p><? my_iptc('caption', ''); ?></p>	
	</div>
	<div id="styles">
	   <ul><li>styles:</li><?php style_switcher(); ?></ul>
	</div>
	<div id="footer">
		<?php mg_powered(); ?> &mdash; <?php validation(); ?> &mdash; if it looks weird in your browser, get a <a href="http://www.mozilla.org/products/firefox/" title="Take back the web with Firefox"><span>better one</span></a>
	</div>