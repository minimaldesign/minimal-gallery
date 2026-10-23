	<h1><?php gallery_name('link') ?> :: last update <?php last_update_date('m.d.y') ?> :: <?php last_update_time() ?></h1>
	<div id="styles">
		<ul>
		    <li>styles:</li><?php style_switcher(); ?>
		</ul>
	</div>
	<div id="nav">
		<ul>
			<li>nav:</li><li><? nav_prev('prev'); ?></li><li><? nav_next(); ?></li><li>/</li><li><? nav_first(); ?></li><li><? nav_last(); ?></li><li>/</li><li><? randomizer('rand'); ?></li>
		    <li>view:</li><?php view_switcher('list', 'thumbs', 'file'); ?>
		</ul>
	</div>
	<div id="cats">
        <ul>
		    <?php categories(); ?>
	    </ul>
	</div>
	<div id="list" class="view">
		<? list_view(); ?>
	</div>
	<div id="footer">
		<?php mg_powered(); ?> &mdash; <?php validation(); ?>
	</div>
	<div id="photoblogs">
		<?php photoblogs(); ?>
	</div>