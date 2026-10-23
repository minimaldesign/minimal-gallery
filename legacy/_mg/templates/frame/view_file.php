	<div id="date">
	   <? current_file_date('l, F jS Y'); ?>
	</div>
	<div id="nav">    
		<ul>
			<li><a href="<?= $_SERVER['PHP_SELF'] ?>" title="home">home</a></li><li>|</li><li><? nav_prev('prev'); ?></li><li><? nav_next(); ?></li><li>|</li><li><? nav_first(); ?></li><li><? nav_last(); ?></li><li>|</li><?php view_switcher('list', 'thumbs', 'file'); ?><li>|</li><?php style_switcher(); ?>
		</ul>
	</div>
	<div id="file" class="view">
		<?php current_file(); ?>	
	</div>
	<div id="mini_thumbs">
	   <? thumbnail_table('1', '1000'); ?>
	</div>
	<div id="footer">
		<?php mg_powered(); ?> &mdash; <?php validation(); ?>
	</div>