	<h1><?php gallery_name('link') ?> :: last update <?php last_update_date('m.d.y') ?> :: <?php last_update_time() ?></h1>
	<div id="styles">
		<ul>
		    <li>styles:</li><?php style_switcher(); ?>
		</ul>
	</div>
	<div id="nav">
		<ul>		
	        <li>nav:</li><? thumbnail_nav('5', '7', '&ndash;', '<li>|</li>'); ?>
		    <li>view:</li><?php view_switcher('list', 'thumbs', 'file'); ?>
		</ul>
	</div>
	<div id="cats">
        <ul>
		    <?php categories(); ?>
	    </ul>
	</div>
	<div id="thumb" class="view">
	<? thumbnail_table('5', '7'); ?>
	</div>
	<div id="footer">
		<?php mg_powered(); ?> &mdash; <?php validation(); ?>
	</div>
	<div id="photoblogs">
		<?php photoblogs(); ?>
	</div>